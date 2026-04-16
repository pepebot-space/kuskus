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
let _isConnected = false; // true = connected to external Chrome (we don't own it)

/**
 * Launch (or reuse) a Puppeteer browser instance.
 * When KUSKUS_CDP_PORT is set, tries to connect to an existing Chrome on that port first.
 * Falls back to launching a new Chrome if no existing instance is found.
 */
export async function launchBrowser() {
    if (_browser && _browser.connected) {
        logger.cdp('Reusing existing browser');
        return _browser;
    }

    // Try to connect to an existing Chrome on the CDP port first
    if (process.env.KUSKUS_CDP_PORT) {
        try {
            _browser = await puppeteer.connect({
                browserURL: `http://localhost:${config.cdpPort}`,
                defaultViewport: null,
            });
            _isConnected = true;
            logger.cdp(`Connected to existing Chrome on port ${config.cdpPort}`);
            _browser.on('disconnected', () => {
                logger.cdp('Browser disconnected');
                _browser = null;
                _page = null;
                _isConnected = false;
            });
            return _browser;
        } catch (_) {
            logger.cdp(`No Chrome found on port ${config.cdpPort}, launching new one`);
        }
    }

    // Resolve Chrome executable and launch
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
    _isConnected = false;
    _browser = await puppeteer.launch(launchOpts);

    _browser.on('disconnected', () => {
        logger.cdp('Browser disconnected');
        _browser = null;
        _page = null;
        _isConnected = false;
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

    await _page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await _page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
    });

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
 * Close or disconnect the browser.
 * If connected to an external Chrome (via --cdp-port), disconnects without closing Chrome.
 * If we launched Chrome ourselves, closes it entirely.
 */
export async function closeBrowser() {
    if (_browser) {
        if (_isConnected) {
            logger.cdp('Disconnecting from external Chrome (leaving it running)');
            await _browser.disconnect();
        } else {
            logger.cdp('Closing browser');
            await _browser.close();
        }
        _browser = null;
        _page = null;
        _isConnected = false;
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
