/**
 * kuskus doctor — environment and dependency checker.
 *
 * Checks:
 *   System   — OS, Node.js version, npm, unzip
 *   Deps     — node_modules packages
 *   Chrome   — env override → system Chrome → cached CfT → auto-install offer
 *   CDP Port — is port available / already occupied (connect mode)
 *   Env vars — active KUSKUS_* config
 */

import { existsSync } from 'fs';
import { platform, arch, release, homedir } from 'os';
import { execSync } from 'child_process';
import { join } from 'path';
import { createServer } from 'net';

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const G = '\x1b[32m';   // green
const Y = '\x1b[33m';   // yellow
const R = '\x1b[31m';   // red
const C = '\x1b[36m';   // cyan
const B = '\x1b[1m';    // bold
const D = '\x1b[2m';    // dim
const X = '\x1b[0m';    // reset

const ok   = (label, detail = '') => console.log(`  ${G}✔${X}  ${label}${detail ? `  ${D}${detail}${X}` : ''}`);
const fail = (label, detail = '') => console.log(`  ${R}✖${X}  ${label}${detail ? `  ${D}${detail}${X}` : ''}`);
const warn = (label, detail = '') => console.log(`  ${Y}⚠${X}  ${label}${detail ? `  ${D}${detail}${X}` : ''}`);
const info = (label, detail = '') => console.log(`  ${C}•${X}  ${label}${detail ? `  ${D}${detail}${X}` : ''}`);
const hint = (text)               => console.log(`     ${D}${text}${X}`);
const sep  = (title)              => { console.log(`\n${B}${title}${X}`); console.log('─'.repeat(52)); };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPortInUse(port) {
    return new Promise((resolve) => {
        const srv = createServer();
        srv.once('error', () => resolve(true));
        srv.once('listening', () => { srv.close(); resolve(false); });
        srv.listen(port, '127.0.0.1');
    });
}

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
    } catch {
        return null;
    }
}

function getChromeVersion(exePath) {
    const v = run(`"${exePath}" --version`) || run(`"${exePath}" --product-version`);
    return v || null;
}

async function getCachedChromeMeta() {
    const metaFile = join(homedir(), '.local', 'chrome', 'meta.json');
    try {
        if (!existsSync(metaFile)) return null;
        const { readFile } = await import('fs/promises');
        const meta = JSON.parse(await readFile(metaFile, 'utf8'));
        return meta.executablePath && existsSync(meta.executablePath) ? meta : null;
    } catch {
        return null;
    }
}

// ─── Platform-specific data ───────────────────────────────────────────────────

const SYSTEM_CHROME = {
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

const CHROME_INSTALL_HINT = {
    darwin: [
        'brew install --cask google-chrome',
        'or download: https://www.google.com/chrome',
    ],
    linux: [
        'sudo apt install chromium-browser        (Debian / Ubuntu)',
        'sudo dnf install chromium                (Fedora / RHEL)',
        'sudo pacman -S chromium                  (Arch)',
    ],
    win32: [
        'winget install Google.Chrome',
        'or download: https://www.google.com/chrome',
    ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runDoctor() {
    // Suppress Node.js built-in deprecation warnings (e.g. punycode in net/puppeteer on Node 24)
    process.noDeprecation = true;

    const os    = platform();
    const cpu   = arch();
    const issues = [];

    console.log(`\n${B}${C}kuskus doctor${X}`);
    console.log('Checking your environment...');

    // ── System ────────────────────────────────────────────────────────────────
    sep('System');
    info('Platform', `${os}  ${release()}  (${cpu})`);

    // Node.js
    const nodeMajor = parseInt(process.version.slice(1), 10);
    if (nodeMajor >= 20) {
        ok('Node.js', process.version);
    } else {
        fail('Node.js', `${process.version} — kuskus requires >=20`);
        issues.push({
            label: 'Node.js too old',
            fix: 'Install Node.js 20+: https://nodejs.org  or via nvm: nvm install 20',
        });
    }

    // npm
    const npmVer = run('npm --version');
    npmVer ? ok('npm', `v${npmVer}`) : (fail('npm not found'), issues.push({ label: 'npm missing', fix: 'Install Node.js from https://nodejs.org (includes npm)' }));

    // unzip — needed by Chrome auto-installer on non-Windows
    if (os !== 'win32') {
        const uz = run('which unzip');
        if (uz) {
            ok('unzip', uz);
        } else {
            warn('unzip not found', 'required for Chrome for Testing auto-install');
            issues.push({
                label: 'unzip missing',
                fix: os === 'darwin'
                    ? 'xcode-select --install  (includes unzip)  or  brew install unzip'
                    : 'sudo apt install unzip   /   sudo dnf install unzip',
            });
        }
    }

    // ── Dependencies ──────────────────────────────────────────────────────────
    sep('Node dependencies');
    const DEPS = ['puppeteer', 'commander', 'zod', '@modelcontextprotocol/sdk'];
    let missingDeps = false;
    for (const dep of DEPS) {
        const p = join(process.cwd(), 'node_modules', dep);
        if (existsSync(p)) {
            ok(dep);
        } else {
            fail(dep, 'not installed');
            missingDeps = true;
        }
    }
    if (missingDeps) {
        issues.push({ label: 'Missing npm dependencies', fix: 'Run: npm install' });
    }

    // ── Chrome ────────────────────────────────────────────────────────────────
    sep('Chrome / Chromium');
    let chromeFound = false;

    // 1. KUSKUS_CHROME_PATH override
    const envPath = process.env.KUSKUS_CHROME_PATH;
    if (envPath) {
        if (existsSync(envPath)) {
            ok('KUSKUS_CHROME_PATH', `${envPath}  ${getChromeVersion(envPath) || ''}`);
            chromeFound = true;
        } else {
            fail('KUSKUS_CHROME_PATH set but not found', envPath);
            issues.push({ label: 'KUSKUS_CHROME_PATH invalid', fix: `Verify the path exists: ${envPath}` });
        }
    }

    // 2. System Chrome
    if (!chromeFound) {
        const candidates = SYSTEM_CHROME[os] || [];
        let found = candidates.find(p => existsSync(p));

        // Also try `which` on Unix
        if (!found && os !== 'win32') {
            for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
                const w = run(`which ${bin}`);
                if (w && existsSync(w)) { found = w; break; }
            }
        }

        if (found) {
            ok('System Chrome', `${found}  ${getChromeVersion(found) || ''}`);
            chromeFound = true;
        }
    }

    // 3. Cached Chrome for Testing (~/.local/chrome)
    if (!chromeFound) {
        const meta = await getCachedChromeMeta();
        if (meta) {
            ok('Chrome for Testing (cached)', `v${meta.version}  ${meta.executablePath}`);
            chromeFound = true;
        }
    }

    // 4. Nothing found — offer to auto-install
    if (!chromeFound) {
        warn('No Chrome found');
        hint('kuskus will auto-download Chrome for Testing on the first run.');
        hint('To install manually:');
        for (const h of (CHROME_INSTALL_HINT[os] || [])) hint(`  ${h}`);
        hint('Or let kuskus install it now:');
        hint('  node bin/kuskus.js call navigate \'{"url":"about:blank"}\'');
    }

    // ── CDP Port ──────────────────────────────────────────────────────────────
    sep('CDP Port');
    const cdpPort = parseInt(process.env.KUSKUS_CDP_PORT || '9222', 10);
    const inUse = await isPortInUse(cdpPort);
    if (inUse) {
        info(`Port ${cdpPort}`, 'occupied — Chrome is likely already running (connect mode ready)');
    } else {
        ok(`Port ${cdpPort}`, 'available');
    }

    // ── Active env vars ───────────────────────────────────────────────────────
    sep('Environment (KUSKUS_*)');
    const ENV_VARS = [
        ['KUSKUS_HEADLESS',        'true'],
        ['KUSKUS_CDP_PORT',        '(unset — launch mode)'],
        ['KUSKUS_WAIT_UNTIL',      'domcontentloaded'],
        ['KUSKUS_NAV_TIMEOUT',     '30000 ms'],
        ['KUSKUS_TOOL_TIMEOUT',    '15000 ms'],
        ['KUSKUS_DEBUG',           'false'],
        ['KUSKUS_CHROME_PATH',     '(auto-detect)'],
        ['KUSKUS_VIEWPORT_WIDTH',  '1280'],
        ['KUSKUS_VIEWPORT_HEIGHT', '720'],
        ['KUSKUS_MAX_STEPS',       '25'],
    ];
    for (const [key, def] of ENV_VARS) {
        const val = process.env[key];
        val !== undefined
            ? info(key, `${val}  ${D}← set${X}`)
            : info(key, `${D}${def} (default)${X}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(52)}`);
    if (issues.length === 0) {
        console.log(`\n${G}${B}✔ All checks passed — kuskus is ready to use.${X}\n`);
    } else {
        console.log(`\n${Y}${B}⚠ ${issues.length} issue(s) to fix:${X}\n`);
        for (const issue of issues) {
            console.log(`  ${R}${B}${issue.label}${X}`);
            console.log(`  ${D}↳ ${issue.fix}${X}\n`);
        }
    }
}
