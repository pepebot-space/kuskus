import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import extract from 'extract-zip';
import { spawnSync } from 'child_process';

const { X_OK } = fs.constants;

const INSTALL_ROOT = path.join(os.homedir(), '.local', 'chrome');
const BIN_DIR = path.join(os.homedir(), '.local', 'bin');
const SYMLINK_PATH = path.join(BIN_DIR, 'chromium');

const PLATFORM_MATRIX = {
  darwin: {
    x64: {
      platform: 'mac-x64',
      archive: 'chrome-mac-x64.zip',
      binary: path.join('chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    },
    arm64: {
      platform: 'mac-arm64',
      archive: 'chrome-mac-arm64.zip',
      binary: path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    },
  },
  linux: {
    x64: {
      platform: 'linux64',
      archive: 'chrome-linux64.zip',
      binary: path.join('chrome-linux64', 'chrome'),
    },
    arm64: {
      platform: 'linux-arm64',
      archive: 'chrome-linux-arm64.zip',
      binary: path.join('chrome-linux-arm64', 'chrome'),
    },
  },
};

function getPlatformConfig() {
  const platform = PLATFORM_MATRIX[process.platform];
  if (!platform) {
    throw new Error(`Unsupported platform for Chromium install: ${process.platform}`);
  }
  const archConfig = platform[process.arch];
  if (!archConfig) {
    throw new Error(`Unsupported architecture for Chromium install: ${process.arch}`);
  }
  return archConfig;
}

async function isExecutable(filePath) {
  if (!filePath) return false;
  try {
    await fsp.access(filePath, X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd) {
  try {
    const { status, stdout } = spawnSync('which', [cmd], { stdio: 'pipe' });
    if (status === 0) {
      const out = stdout.toString().trim();
      return out.length ? out : null;
    }
  } catch {
    // ignore
  }
  return null;
}

function candidatePaths() {
  const paths = [];
  const envCandidates = [
    process.env.CDP_BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ].filter(Boolean);
  paths.push(...envCandidates);

  if (process.platform === 'darwin') {
    const home = os.homedir();
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    );
  } else if (process.platform === 'linux') {
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    );
  }

  const commandCandidates = process.platform === 'darwin'
    ? ['google-chrome', 'chromium']
    : ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];

  for (const cmd of commandCandidates) {
    const resolved = which(cmd);
    if (resolved) paths.push(resolved);
  }

  paths.push(SYMLINK_PATH);
  return [...new Set(paths)];
}

export async function findChromeBinary() {
  const candidates = candidatePaths();
  for (const p of candidates) {
    if (await isExecutable(p)) return p;
  }
  return null;
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetch(res.headers.location));
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Request failed: ${res.statusCode} ${res.statusMessage || ''}`.trim()));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

async function download(url, dest) {
  const res = await fetch(url);
  await pipeline(res, fs.createWriteStream(dest));
}

async function fetchLatestStableVersion() {
  return new Promise((resolve, reject) => {
    https
      .get('https://storage.googleapis.com/chrome-for-testing-public/LATEST_RELEASE_STABLE', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const version = data.trim();
          if (!version) {
            reject(new Error('Failed to read latest Chromium version'));
          } else {
            resolve(version);
          }
        });
      })
      .on('error', reject);
  });
}

async function ensureDirectories() {
  await fsp.mkdir(INSTALL_ROOT, { recursive: true });
  await fsp.mkdir(BIN_DIR, { recursive: true });
}

export async function ensureChromium({ force = false, log = () => {} } = {}) {
  await ensureDirectories();

  const config = getPlatformConfig();
  const version = await fetchLatestStableVersion();
  const versionDir = path.join(INSTALL_ROOT, version);
  const binaryPath = path.join(versionDir, config.binary);

  if (!force && await isExecutable(binaryPath)) {
    log(`Chromium already installed at ${binaryPath}`);
    await ensureSymlink(binaryPath, log);
    return binaryPath;
  }

  log(`Downloading Chromium ${version} for ${config.platform}...`);

  await fsp.rm(versionDir, { recursive: true, force: true });
  await fsp.mkdir(versionDir, { recursive: true });

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kuskus-chrome-'));
  const archivePath = path.join(tmpDir, config.archive);
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${config.platform}/${config.archive}`;

  try {
    await download(url, archivePath);
    await extract(archivePath, { dir: versionDir });
    await fsp.chmod(binaryPath, 0o755);
  } catch (err) {
    await fsp.rm(versionDir, { recursive: true, force: true });
    throw err;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  await ensureSymlink(binaryPath, log);
  log(`Chromium installed at ${binaryPath}`);
  return binaryPath;
}

async function ensureSymlink(binaryPath, log) {
  try {
    const linkStat = await fsp.lstat(SYMLINK_PATH);
    if (linkStat.isSymbolicLink()) {
      const current = await fsp.readlink(SYMLINK_PATH).catch(() => null);
      if (current !== binaryPath) {
        await fsp.unlink(SYMLINK_PATH);
      } else {
        return;
      }
    } else {
      await fsp.unlink(SYMLINK_PATH);
    }
  } catch {
    // no existing link
  }

  try {
    await fsp.symlink(binaryPath, SYMLINK_PATH);
    log(`Symlinked Chromium to ${SYMLINK_PATH}`);
  } catch (err) {
    log(`Failed to symlink Chromium: ${err.message}`);
  }
}

export { INSTALL_ROOT, BIN_DIR, SYMLINK_PATH };
