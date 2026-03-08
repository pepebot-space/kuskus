/**
 * Chrome Resolver — detect system Chrome/Chromium or auto-install Chrome for Testing.
 *
 * Detection order:
 *   1. KUSKUS_CHROME_PATH env var (explicit override)
 *   2. System Chrome/Chromium (OS-specific paths)
 *   3. Previously installed Chrome in ~/.local/chrome/
 *   4. Auto-download Chrome for Testing from Google's CDN
 */

import { existsSync } from 'fs';
import { mkdir, writeFile, readFile, chmod } from 'fs/promises';
import { execSync, execFileSync } from 'child_process';
import { homedir, platform, arch } from 'os';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const CHROME_DIR = join(homedir(), '.local', 'chrome');
const META_FILE = join(CHROME_DIR, 'meta.json');

// Chrome for Testing JSON API
const CHROME_JSON_API = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

// ─── System Chrome detection paths ───────────────────────────────────────────

const SYSTEM_PATHS = {
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        `${homedir()}/Applications/Chromium.app/Contents/MacOS/Chromium`,
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/local/bin/chrome',
        '/usr/local/bin/chromium',
    ],
    win32: [
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Chromium\\Application\\chrome.exe`,
    ],
};

// ─── Platform mapping for Chrome for Testing downloads ───────────────────────

function getCftPlatform() {
    const os = platform();
    const cpu = arch();

    if (os === 'darwin') {
        return cpu === 'arm64' ? 'mac-arm64' : 'mac-x64';
    }
    if (os === 'linux') {
        return 'linux64';
    }
    if (os === 'win32') {
        return cpu === 'x64' ? 'win64' : 'win32';
    }
    throw new Error(`Unsupported platform: ${os}-${cpu}`);
}

// ─── Detect system Chrome ────────────────────────────────────────────────────

function detectSystemChrome() {
    const os = platform();
    const paths = SYSTEM_PATHS[os] || [];

    for (const p of paths) {
        if (existsSync(p)) {
            logger.info(`System Chrome found: ${p}`);
            return p;
        }
    }

    // Try 'which' on Unix
    if (os !== 'win32') {
        for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
            try {
                const result = execSync(`which ${bin}`, { encoding: 'utf8' }).trim();
                if (result && existsSync(result)) {
                    logger.info(`System Chrome found via which: ${result}`);
                    return result;
                }
            } catch {
                // not found, continue
            }
        }
    }

    return null;
}

// ─── Check previously installed Chrome ───────────────────────────────────────

async function getInstalledChrome() {
    try {
        if (!existsSync(META_FILE)) return null;
        const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
        if (meta.executablePath && existsSync(meta.executablePath)) {
            logger.info(`Using installed Chrome: ${meta.executablePath} (v${meta.version})`);
            return meta.executablePath;
        }
    } catch {
        // corrupted meta, ignore
    }
    return null;
}

// ─── Download and install Chrome for Testing ─────────────────────────────────

async function installChrome() {
    const cftPlatform = getCftPlatform();
    logger.print(`\n📥 No Chrome found. Downloading Chrome for Testing (${cftPlatform})...`);

    // Fetch version info
    const response = await fetch(CHROME_JSON_API);
    if (!response.ok) {
        throw new Error(`Failed to fetch Chrome versions: ${response.status}`);
    }
    const data = await response.json();
    const stable = data.channels.Stable;
    const version = stable.version;

    // Find download URL for our platform
    const downloads = stable.downloads.chrome;
    const download = downloads.find(d => d.platform === cftPlatform);
    if (!download) {
        throw new Error(`No Chrome download available for platform: ${cftPlatform}`);
    }

    logger.print(`   Version: ${version}`);
    logger.print(`   URL: ${download.url}`);

    // Create install directory
    const installDir = join(CHROME_DIR, version);
    await mkdir(installDir, { recursive: true });

    // Download
    const zipPath = join(CHROME_DIR, `chrome-${version}.zip`);
    logger.print('   Downloading...');

    const dlResponse = await fetch(download.url);
    if (!dlResponse.ok) {
        throw new Error(`Download failed: ${dlResponse.status}`);
    }

    const buffer = Buffer.from(await dlResponse.arrayBuffer());
    await writeFile(zipPath, buffer);
    logger.print(`   Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    // Extract
    logger.print('   Extracting...');
    const os = platform();

    if (os === 'win32') {
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installDir}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`unzip -o -q "${zipPath}" -d "${installDir}"`, { stdio: 'pipe' });
    }

    // Find the executable
    let executablePath;
    const extractedDir = join(installDir, `chrome-${cftPlatform}`);

    if (os === 'darwin') {
        const appPath = join(extractedDir, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (existsSync(appPath)) {
            executablePath = appPath;
        }
    } else if (os === 'linux') {
        executablePath = join(extractedDir, 'chrome');
        if (existsSync(executablePath)) {
            await chmod(executablePath, 0o755);
        }
    } else if (os === 'win32') {
        executablePath = join(extractedDir, 'chrome.exe');
    }

    if (!executablePath || !existsSync(executablePath)) {
        throw new Error(`Chrome executable not found after extraction in ${installDir}`);
    }

    // Clean up zip
    try {
        const { unlink } = await import('fs/promises');
        await unlink(zipPath);
    } catch { /* ignore */ }

    // Save metadata
    await writeFile(META_FILE, JSON.stringify({
        version,
        platform: cftPlatform,
        executablePath,
        installedAt: new Date().toISOString(),
    }, null, 2));

    logger.print(`   ✅ Chrome ${version} installed to ${installDir}`);
    return executablePath;
}

// ─── Main resolver ───────────────────────────────────────────────────────────

/**
 * Resolve a Chrome/Chromium executable path.
 * Priority: env var → system Chrome → installed Chrome → auto-download.
 */
export async function resolveChromePath() {
    // 1. Explicit env override
    if (config.chromePath) {
        if (!existsSync(config.chromePath)) {
            throw new Error(`KUSKUS_CHROME_PATH set but not found: ${config.chromePath}`);
        }
        logger.info(`Using Chrome from KUSKUS_CHROME_PATH: ${config.chromePath}`);
        return config.chromePath;
    }

    // 2. System Chrome
    const systemChrome = detectSystemChrome();
    if (systemChrome) return systemChrome;

    // 3. Previously installed
    const installed = await getInstalledChrome();
    if (installed) return installed;

    // 4. Auto-download
    return await installChrome();
}
