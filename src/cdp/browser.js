/**
 * CDP Browser Manager — wraps Puppeteer for headless/headful Chrome control.
 * Uses chrome-resolver to detect system Chrome or auto-install if needed.
 */

import puppeteer from 'puppeteer';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { resolveChromePath } from './chrome-resolver.js';

let _browser = null;
let _page = null;

/**
 * Launch (or reuse) a Puppeteer browser instance.
 * Resolves Chrome path: env var → system Chrome → ~/.local/chrome → auto-download.
 */
export async function launchBrowser() {
    if (_browser && _browser.connected) {
        logger.cdp('Reusing existing browser');
        return _browser;
    }

    // Resolve Chrome executable
    const chromePath = await resolveChromePath();
    logger.cdp('Using Chrome:', chromePath);

    const launchOpts = {
        headless: config.headless ? 'new' : false,
        executablePath: chromePath,
        args: [
            `--remote-debugging-port=${config.cdpPort}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            `--window-size=${config.viewport.width},${config.viewport.height}`,
        ],
        defaultViewport: {
            width: config.viewport.width,
            height: config.viewport.height,
        },
    };

    logger.cdp('Launching browser', { headless: config.headless, port: config.cdpPort });
    _browser = await puppeteer.launch(launchOpts);

    _browser.on('disconnected', () => {
        logger.cdp('Browser disconnected');
        _browser = null;
        _page = null;
    });

    return _browser;
}

/**
 * Get (or create) the active page.
 */
export async function getPage() {
    if (_page && !_page.isClosed()) {
        return _page;
    }

    const browser = await launchBrowser();
    const pages = await browser.pages();
    _page = pages[0] || await browser.newPage();

    _page.setDefaultNavigationTimeout(config.navigationTimeout);
    _page.setDefaultTimeout(config.toolTimeout);

    // Capture console logs
    _page._consoleLogs = [];
    _page.on('console', (msg) => {
        const entry = {
            type: msg.type(),
            text: msg.text(),
            timestamp: Date.now(),
        };
        _page._consoleLogs.push(entry);
        logger.cdp(`Console [${entry.type}]:`, entry.text);
    });

    // Capture network requests
    _page._networkRequests = [];
    _page._networkCapture = false;

    logger.cdp('Page ready');
    return _page;
}

/**
 * Close the browser.
 */
export async function closeBrowser() {
    if (_browser) {
        logger.cdp('Closing browser');
        await _browser.close();
        _browser = null;
        _page = null;
    }
}

/**
 * Get the CDP session for advanced protocol access.
 */
export async function getCDPSession() {
    const page = await getPage();
    const client = await page.createCDPSession();
    logger.cdp('CDP session created');
    return client;
}
