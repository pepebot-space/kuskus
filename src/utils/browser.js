import { spawn } from 'child_process';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { ensureChromium, findChromeBinary } from './chromium.js';

const POLL_INTERVAL = 200;    // ms between CDP checks
const POLL_TIMEOUT = 15_000;  // ms max wait for browser to start
const SHUTDOWN_TIMEOUT = 5_000;
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.local', 'chrome-profile');

/**
 * Check if a CDP endpoint is reachable.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isCDPReady(host, port) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/json/version', timeout: 500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Poll until CDP is ready or timeout expires.
 */
async function waitForCDP(host, port, timeout = POLL_TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await isCDPReady(host, port)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Browser did not become ready on ${host}:${port} within ${timeout}ms`);
}

/**
 * Ensure a Chrome/Chromium instance is running and CDP is available.
 *
 * - If a browser is already listening on the port, returns null (no new process).
 * - Otherwise, locates (or downloads) a Chromium binary, launches it, and waits for CDP.
 *
 * @param {object} opts
 * @param {number}  opts.port     CDP port (default 9222)
 * @param {string}  opts.host     host (default localhost)
 * @param {boolean} opts.install  Auto-download if missing (default true)
 * @param {(msg: string) => void} opts.log  Progress callback
 * @returns {Promise<import('child_process').ChildProcess | null>}
 */
export async function ensureBrowser({
  port = 9222,
  host = 'localhost',
  install = true,
  binaryPath = null,
  headless = true,
  force = false,
  userDataDir = null,
  log = () => {},
} = {}) {
  // Already running?
  if (await isCDPReady(host, port)) {
    if (force) {
      log(`Closing existing browser on ${host}:${port}...`);
      const closed = await closeExistingBrowser({ host, port, log }).catch((err) => {
        log(`Failed to close existing browser: ${err.message}`);
        return false;
      });
      if (!closed && await isCDPReady(host, port)) {
        log(`Browser already running on ${host}:${port}`);
        return null;
      }
    } else {
      log(`Browser already running on ${host}:${port}`);
      return null;
    }
  }

  const resolvedBinary = await resolveBinary({ binaryPath, install, log });

  log(`Launching Chromium on port ${port}...`);

  const usePersistentProfile = Boolean(userDataDir) || !headless;
  let profileDir;
  let tempProfileDir = null;

  if (usePersistentProfile) {
    profileDir = userDataDir || DEFAULT_PROFILE_DIR;
    await fsp.mkdir(profileDir, { recursive: true });
    log(`Using Chrome profile at ${profileDir}`);
  } else {
    tempProfileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kuskus-chrome-'));
    profileDir = tempProfileDir;
  }

  const args = [
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=${host}`,
  ];

  if (headless) {
    args.unshift('--headless=new');
  }

  if (profileDir) {
    args.push(`--user-data-dir=${profileDir}`);
  }

  args.push('about:blank');

  const proc = spawn(resolvedBinary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.on('error', (err) => {
    throw new Error(`Failed to launch Chromium: ${err.message}`);
  });

  // Surface stderr only in debug mode
  if (process.env.LOG_LEVEL === 'debug') {
    proc.stderr?.on('data', (d) => process.stderr.write(d));
  }

  proc.once('exit', async () => {
    if (tempProfileDir) {
      await fsp.rm(tempProfileDir, { recursive: true, force: true });
    }
  });

  await waitForCDP(host, port);
  log(`Browser ready on ${host}:${port}`);

  return proc;
}

async function resolveBinary({ binaryPath, install, log }) {
  const candidates = [binaryPath, process.env.CDP_BROWSER_PATH];
  for (const candidate of candidates) {
    if (candidate && await isExecutable(candidate)) return candidate;
  }

  const detected = await findChromeBinary();
  if (detected) {
    log(`Detected Chrome binary at ${detected}`);
    return detected;
  }

  if (!install) {
    throw new Error('No Chrome/Chromium binary found. Set CDP_BROWSER_PATH or provide --launch-path.');
  }

  return ensureChromium({ log });
}

async function isExecutable(filePath) {
  if (!filePath) return false;
  try {
    await fsp.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function closeExistingBrowser({ host, port, log }) {
  const info = await getBrowserInfo(host, port);
  if (!info?.webSocketDebuggerUrl) return false;

  const { WebSocket } = await import('ws');

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(info.webSocketDebuggerUrl);
    socket.on('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    });
    socket.on('close', resolve);
    socket.on('error', reject);
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1 && msg.error) {
          reject(new Error(msg.error.message || 'Browser.close failed'));
        }
      } catch {
        // ignore
      }
    });
  });

  const deadline = Date.now() + SHUTDOWN_TIMEOUT;
  while (Date.now() < deadline) {
    if (!(await isCDPReady(host, port))) {
      log(`Closed existing browser on ${host}:${port}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error('Browser did not exit after close request');
}

function getBrowserInfo(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: '/json/version', timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out fetching browser info')); });
  });
}
