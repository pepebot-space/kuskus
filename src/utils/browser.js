import { spawn } from 'child_process';
import http from 'http';
import { ensureLightpanda, BINARY_PATH } from './install.js';

const POLL_INTERVAL = 200;   // ms between CDP readiness checks
const POLL_TIMEOUT  = 15_000; // ms max wait for browser to start

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
 * Ensure Lightpanda is running and CDP is available.
 *
 * - If a browser is already listening on the port, returns null (no new process).
 * - Otherwise, downloads the binary if needed, launches it, and waits for CDP.
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
  log = () => {},
} = {}) {
  // Already running?
  if (await isCDPReady(host, port)) {
    log(`Browser already running on ${host}:${port}`);
    return null;
  }

  // Find or download binary
  const binaryPath = install
    ? await ensureLightpanda({ log })
    : (process.env.CDP_BROWSER_PATH || BINARY_PATH);

  log(`Launching Lightpanda on port ${port}...`);

  const proc = spawn(binaryPath, ['serve', '--host', host, '--port', String(port), '--timeout', '3600'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.on('error', (err) => {
    throw new Error(`Failed to launch Lightpanda: ${err.message}`);
  });

  // Surface stderr only in debug mode
  if (process.env.LOG_LEVEL === 'debug') {
    proc.stderr?.on('data', (d) => process.stderr.write(d));
  }

  await waitForCDP(host, port);
  log(`Browser ready on ${host}:${port}`);

  return proc;
}
