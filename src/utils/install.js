import https from 'https';
import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';

const GITHUB_REPO = 'lightpanda-io/browser';
const INSTALL_DIR = path.join(os.homedir(), '.local', 'bin');
const BINARY_PATH = path.join(INSTALL_DIR, 'lightpanda');

/**
 * Map Node.js platform/arch → Lightpanda release asset name.
 * Follows the naming used in lightpanda-io/browser GitHub releases.
 */
function getAssetName() {
  const platform = process.platform;
  const arch = process.arch;

  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = { linux: 'linux', darwin: 'macos' };

  const a = archMap[arch];
  const p = platformMap[platform];

  if (!a) throw new Error(`Unsupported architecture: ${arch}`);
  if (!p) throw new Error(`Unsupported platform: ${platform} (Windows is not supported by Lightpanda)`);

  return `lightpanda-${a}-${p}`;
}

/**
 * Fetch the latest release metadata from GitHub API.
 * @returns {Promise<{ tag: string, assetUrl: string }>}
 */
async function fetchLatestRelease() {
  const assetName = getAssetName();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'kuskus-installer' },
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const asset = release.assets?.find((a) => a.name === assetName);
          if (!asset) {
            // Fallback: construct direct download URL from tag
            const tag = release.tag_name;
            resolve({
              tag,
              assetUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`,
            });
          } else {
            resolve({ tag: release.tag_name, assetUrl: asset.browser_download_url });
          }
        } catch (e) {
          reject(new Error(`Failed to parse GitHub API response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Download a URL to a file path, following redirects.
 * @param {string} url
 * @param {string} dest
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const get = u.startsWith('https://') ? https.get : http.get;
      get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode} from ${u}`));
        }
        const file = fs.createWriteStream(dest);
        pipeline(res, file).then(resolve).catch(reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

/**
 * Ensure Lightpanda binary is installed at ~/.local/bin/lightpanda.
 * Downloads from GitHub releases if not already present.
 *
 * @param {object} opts
 * @param {boolean} opts.force  Re-download even if already installed.
 * @param {(msg: string) => void} opts.log  Progress callback.
 * @returns {Promise<string>}  Path to the installed binary.
 */
export async function ensureLightpanda({ force = false, log = () => {} } = {}) {
  // Check if already installed
  if (!force) {
    try {
      await fsp.access(BINARY_PATH, fs.constants.X_OK);
      log(`Lightpanda already installed at ${BINARY_PATH}`);
      return BINARY_PATH;
    } catch {
      // Not installed, proceed to download
    }
  }

  log('Fetching latest Lightpanda release from GitHub...');
  const { tag, assetUrl } = await fetchLatestRelease();
  log(`Downloading Lightpanda ${tag} (${getAssetName()})...`);

  // Ensure install dir exists
  await fsp.mkdir(INSTALL_DIR, { recursive: true });

  const tmpPath = `${BINARY_PATH}.tmp`;
  try {
    await download(assetUrl, tmpPath);
    await fsp.rename(tmpPath, BINARY_PATH);
    await fsp.chmod(BINARY_PATH, 0o755);
    log(`Lightpanda ${tag} installed at ${BINARY_PATH}`);
    return BINARY_PATH;
  } catch (err) {
    // Clean up tmp file on failure
    await fsp.rm(tmpPath, { force: true });
    throw err;
  }
}

export { BINARY_PATH, INSTALL_DIR };
