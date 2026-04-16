/**
 * CDP Tools — all Chrome DevTools Protocol tools accessible via MCP and CLI.
 *
 * Categories:
 *   Navigation   — navigate, goBack, goForward, reload
 *   Interaction  — click, type, hover, selectOption, pressKey, scroll
 *   Inspection   — snapshot, screenshot, getConsoleLogs, evaluate
 *   Network      — getNetworkRequests, enableNetworkCapture
 *   Performance  — getPerformanceMetrics, startTrace, stopTrace
 *   Accessibility — getAccessibilityTree
 */

import { z } from 'zod';
import { gunzipSync } from 'node:zlib';
import { getPage, getCDPSession, closeBrowser } from './browser.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

// ─── Tool Registry ───────────────────────────────────────────────────────────

export const tools = {};

function defineTool(name, description, schema, handler) {
    tools[name] = { name, description, schema, handler };
}

// ─── Navigation ──────────────────────────────────────────────────────────────

defineTool('navigate', 'Navigate to a URL', z.object({
    url: z.string().describe('The URL to navigate to'),
}), async ({ url }) => {
    logger.tool('navigate →', url);
    const page = await getPage();

    let targetUrl = url;
    let searchGuardNote = '';

    try {
        const parsed = new URL(url);
        const host = parsed.host.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        const hasQueryParam = parsed.searchParams.has('q');

        const isGoogleSearch = /(^|\.)google\./i.test(host) && path.startsWith('/search');
        const isBingSearch = host.includes('bing.com') && path.startsWith('/search');
        const isYahooSearch = host === 'search.yahoo.com' && path.startsWith('/search');

        if (hasQueryParam && (isGoogleSearch || isBingSearch || isYahooSearch)) {
            targetUrl = `${parsed.protocol}//${parsed.host}/`;
            searchGuardNote = `Direct search query navigation blocked for ${parsed.host}. Landed on homepage instead; use the on-page search box to continue.`;
            logger.tool('navigate search-guard → redirected to homepage');
        }
    } catch (err) {
        logger.tool('navigate URL parse error →', err.message);
    }

    const response = await page.goto(targetUrl, { waitUntil: config.waitUntil });
    const title = await page.title();
    let textPreview = '';
    let htmlPreview = '';
    let formHints = [];
    let dataTestIds = [];
    let structuredData = [];
    let mainContentAvailable = false;
    let fullTextLength = 0;
    try {
        const pageData = await page.evaluate(() => {
            const body = document.body;

            function simplify(str, max = 160) {
                if (!str) return '';
                const normalized = str.replace(/\s+/g, ' ').trim();
                return normalized.length > max ? normalized.slice(0, max) + '…' : normalized;
            }

            function buildSelector(el) {
                if (!el) return '';
                const tag = el.tagName.toLowerCase();
                if (el.id) return `#${el.id}`;
                const name = el.getAttribute('name');
                if (name) return `${tag}[name="${name}"]`;
                const aria = el.getAttribute('aria-label');
                if (aria) return `${tag}[aria-label="${aria}"]`;
                const placeholder = el.getAttribute('placeholder');
                if (placeholder) return `${tag}[placeholder="${placeholder}"]`;
                const type = el.getAttribute('type');
                if (type) return `${tag}[type="${type}"]`;
                return tag;
            }

            // Main content heuristic — pick the densest meaningful container.
            function pickMainContainer() {
                const explicit = document.querySelector('article')
                    || document.querySelector('main')
                    || document.querySelector('[role="main"]')
                    || document.querySelector('#content, #main, .content, .main, .post, .article, .entry-content');
                if (explicit) return explicit;

                const candidates = Array.from(document.querySelectorAll('div, section'));
                let best = null;
                let bestScore = 0;
                for (const el of candidates) {
                    const text = (el.innerText || '').trim();
                    if (text.length < 200) continue;
                    const tagCount = el.getElementsByTagName('*').length || 1;
                    const score = text.length / Math.sqrt(tagCount);
                    if (score > bestScore) {
                        bestScore = score;
                        best = el;
                    }
                }
                return best || body;
            }

            const mainContainer = pickMainContainer();
            const mainText = (mainContainer?.innerText || body?.innerText || '').trim();

            const inputs = Array.from(document.querySelectorAll('input, textarea, button')).slice(0, 30).map((el) => ({
                selector: buildSelector(el),
                tag: el.tagName.toLowerCase(),
                id: simplify(el.id, 120),
                name: simplify(el.getAttribute('name'), 120),
                placeholder: simplify(el.getAttribute('placeholder'), 160),
                ariaLabel: simplify(el.getAttribute('aria-label'), 160),
                type: simplify(el.getAttribute('type'), 60),
                classes: simplify(el.className, 160),
                text: simplify(el.innerText, 160),
                value: simplify(el.value, 120),
            })).filter(Boolean);

            const dataTestIds = Array.from(document.querySelectorAll('[data-testid]'))
                .slice(0, 40)
                .map((el) => {
                    const value = el.getAttribute('data-testid');
                    if (!value) return null;
                    const tag = el.tagName.toLowerCase();
                    return {
                        selector: `${tag}[data-testid="${value}"]`,
                        dataTestId: value,
                        text: simplify(el.innerText, 160),
                    };
                })
                .filter(Boolean);

            const html = body?.innerHTML || '';

            return {
                text: mainText.slice(0, 8000),
                fullTextLength: mainText.length,
                html: html.slice(0, 4000),
                inputs,
                dataTestIds,
            };
        });

        textPreview = (pageData.text || '').trim();
        htmlPreview = pageData.html || '';
        formHints = pageData.inputs || [];
        dataTestIds = pageData.dataTestIds || [];
        fullTextLength = pageData.fullTextLength || 0;
        mainContentAvailable = fullTextLength > textPreview.length;
    } catch (err) {
        logger.tool('navigate textPreview error →', err.message);
    }

    try {
        structuredData = await page.evaluate(() => {
            const cache = window.__cache || window.__CACHE__;
            if (!cache) return [];

            const simplify = (str, max = 160) => {
                if (!str) return '';
                const normalized = String(str).replace(/\s+/g, ' ').trim();
                return normalized.length > max ? normalized.slice(0, max) + '…' : normalized;
            };

            const resolveRef = (ref) => {
                if (!ref) return null;
                if (typeof ref === 'string') return cache[ref] || null;
                if (typeof ref === 'object' && ref !== null) {
                    const key = ref.id || ref.__ref;
                    return key ? cache[key] || null : null;
                }
                return null;
            };

            const products = [];
            for (const key of Object.keys(cache)) {
                if (!/^searchProductV5Product\d+$/i.test(key)) continue;
                const entry = cache[key];
                if (!entry || !entry.name) continue;

                const priceEntry = resolveRef(entry.price);
                const priceText = priceEntry?.text || priceEntry?.priceDisplay || '';

                products.push({
                    name: simplify(entry.name, 200),
                    price: simplify(priceText, 80),
                    url: entry.url || '',
                });
                if (products.length >= 10) break;
            }
            return products;
        }) || [];
    } catch (err) {
        logger.tool('navigate structuredData error →', err.message);
    }

    try {
        const currentUrl = page.url();
        if (/bing\.com\/.+/.test(currentUrl) && /[?&]q=/.test(currentUrl)) {
            const bingResults = await page.evaluate(() => {
                const simplify = (str, max = 200) => {
                    if (!str) return '';
                    const normalized = str.replace(/\s+/g, ' ').trim();
                    return normalized.length > max ? normalized.slice(0, max) + '…' : normalized;
                };
                const results = Array.from(document.querySelectorAll('#b_results > li.b_algo'))
                    .slice(0, 8)
                    .map((item, index) => {
                        const link = item.querySelector('a');
                        const caption = item.querySelector('p, .b_caption p, .b_paractl');
                        const cite = item.querySelector('cite');
                        return {
                            name: simplify(link?.innerText || ''),
                            url: link?.href || '',
                            snippet: simplify(caption?.innerText || ''),
                            displayUrl: simplify(cite?.innerText || ''),
                            rank: index + 1,
                            source: 'bing_search',
                        };
                    })
                    .filter(entry => entry.name && entry.url);

                const news = Array.from(document.querySelectorAll('#b_results .b_nwsCard'))
                    .slice(0, 6)
                    .map((item, index) => {
                        const link = item.querySelector('a');
                        const caption = item.querySelector('div.item_snippet, p');
                        const source = item.querySelector('.source');
                        return {
                            name: simplify(link?.innerText || ''),
                            url: link?.href || '',
                            snippet: simplify(caption?.innerText || ''),
                            outlet: simplify(source?.innerText || ''),
                            rank: index + 1,
                            source: 'bing_news',
                        };
                    })
                    .filter(entry => entry.name && entry.url);

                const calculator = document.querySelector('#b_results .b_focusLabel + div');
                const focusText = simplify(calculator?.innerText || '');
                const focus = focusText ? [{ name: 'bing_focus', url: '', snippet: focusText, source: 'bing_focus' }] : [];

                return [...focus, ...results, ...news];
            });
            if (bingResults && bingResults.length) {
                structuredData = structuredData.concat(bingResults);
            }
        }
    } catch (err) {
        logger.tool('navigate bing extraction error →', err.message);
    }

    const strategyHints = [];
    if (searchGuardNote) {
        strategyHints.push(searchGuardNote);
    }
    try {
        const currentUrl = page.url();
        if (/tokopedia\.com\/search/i.test(currentUrl)) {
            strategyHints.push('Tokopedia provides SSR results at https://www.tokopedia.com/find/<query>. Consider navigating there for easier parsing.');
        }
        const combinedPreview = `${textPreview} ${htmlPreview}`.toLowerCase();
        const captchaSignals = [
            'our systems have detected unusual traffic from your computer network',
            'before we can process your request',
            'are you a robot?',
            'sorry, but we could not process your request',
            'enter the characters you see below',
            'press & hold to confirm you are not a robot'
        ];
        if (captchaSignals.some(signal => combinedPreview.includes(signal))) {
            strategyHints.push('Search engine returned a captcha challenge. Switch to an alternate engine like https://www.bing.com and continue the search there.');
        }
    } catch (err) {
        logger.tool('navigate hint generation error →', err.message);
    }

    if (mainContentAvailable) {
        strategyHints.push(`Main content is ${fullTextLength} chars; textPreview shows first ${textPreview.length}. Call readPage for the full cleaned body text instead of scrolling/snapshotting.`);
    }

    return {
        url: page.url(),
        title,
        status: response?.status() ?? null,
        textPreview,
        fullTextLength,
        mainContentAvailable,
        htmlPreview,
        formHints,
        dataTestIds,
        structuredData,
        strategyHints,
    };
});

defineTool('goBack', 'Go back in browser history', z.object({}), async () => {
    logger.tool('goBack');
    const page = await getPage();
    await page.goBack({ waitUntil: config.waitUntil });
    return { url: page.url(), title: await page.title() };
});

defineTool('goForward', 'Go forward in browser history', z.object({}), async () => {
    logger.tool('goForward');
    const page = await getPage();
    await page.goForward({ waitUntil: config.waitUntil });
    return { url: page.url(), title: await page.title() };
});

defineTool('reload', 'Reload the current page', z.object({}), async () => {
    logger.tool('reload');
    const page = await getPage();
    await page.reload({ waitUntil: config.waitUntil });
    return { url: page.url(), title: await page.title() };
});

// ─── Interaction ─────────────────────────────────────────────────────────────

defineTool('click', 'Click an element by CSS selector', z.object({
    selector: z.string().describe('CSS selector of the element to click'),
}), async ({ selector }) => {
    logger.tool('click →', selector);
    const page = await getPage();
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    return { clicked: selector };
});

defineTool('type', 'Type text into an element', z.object({
    selector: z.string().describe('CSS selector of the input element'),
    text: z.string().describe('Text to type'),
    clearFirst: z.boolean().optional().describe('Clear the field before typing'),
}), async ({ selector, text, clearFirst }) => {
    logger.tool('type →', selector, text);
    const page = await getPage();
    const randomDelay = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
    const wait = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let targetSelector = selector;
    let handle;
    try {
        handle = await page.waitForSelector(targetSelector, { timeout: 8000, visible: true });
    } catch (err) {
        if (targetSelector.includes('input[') && !targetSelector.includes('textarea[')) {
            const fallback = targetSelector.replace('input', 'textarea');
            try {
                handle = await page.waitForSelector(fallback, { timeout: 8000, visible: true });
                targetSelector = fallback;
                logger.tool('type fallback selector →', fallback);
            } catch (err2) {
                throw err;
            }
        } else {
            throw err;
        }
    }

    const box = await handle.boundingBox();
    if (box) {
        await wait(randomDelay(80, 180));
        await page.mouse.move(box.x + box.width / 2 + randomDelay(-5, 5), box.y + box.height / 2 + randomDelay(-3, 3), { steps: randomDelay(5, 12) });
        await wait(randomDelay(80, 160));
    }

    await handle.focus();
    await wait(randomDelay(120, 260));

    if (clearFirst) {
        await handle.click({ clickCount: 3, delay: randomDelay(80, 120) });
        await wait(randomDelay(80, 160));
        await page.keyboard.press('Backspace');
        await wait(randomDelay(120, 220));
    } else {
        await handle.click({ delay: randomDelay(80, 140) });
        await wait(randomDelay(100, 220));
    }
    await page.type(targetSelector, text, { delay: randomDelay(70, 150) });
    await wait(randomDelay(80, 180));
    return { typed: text, into: selector };
});

defineTool('hover', 'Hover over an element', z.object({
    selector: z.string().describe('CSS selector of the element'),
}), async ({ selector }) => {
    logger.tool('hover →', selector);
    const page = await getPage();
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.hover(selector);
    return { hovered: selector };
});

defineTool('selectOption', 'Select an option from a <select> element', z.object({
    selector: z.string().describe('CSS selector of the <select> element'),
    value: z.string().describe('Value to select'),
}), async ({ selector, value }) => {
    logger.tool('selectOption →', selector, value);
    const page = await getPage();
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.select(selector, value);
    return { selected: value, in: selector };
});

defineTool('pressKey', 'Press a keyboard key', z.object({
    key: z.string().describe('Key to press (e.g. Enter, Tab, Escape, ArrowDown)'),
}), async ({ key }) => {
    logger.tool('pressKey →', key);
    const page = await getPage();
    await page.keyboard.press(key);
    return { pressed: key };
});

defineTool('scroll', 'Scroll the page or an element', z.object({
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Direction to scroll'),
    amount: z.number().optional().describe('Pixels to scroll (default: 500)'),
    selector: z.string().optional().describe('CSS selector of element to scroll (default: page)'),
}), async ({ direction, amount = 500, selector }) => {
    logger.tool('scroll →', direction, amount, selector);
    const page = await getPage();

    const result = await page.evaluate(({ direction, amount, selector }) => {
        const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
        const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

        if (selector) {
            const target = document.querySelector(selector);
            if (!target) {
                return { error: `Element not found for selector: ${selector}` };
            }

            if (typeof target.scrollBy === 'function') {
                target.scrollBy(dx, dy);
            } else {
                target.scrollTop = (target.scrollTop || 0) + dy;
                target.scrollLeft = (target.scrollLeft || 0) + dx;
            }

            return {
                target: selector,
                scrollTop: target.scrollTop ?? null,
                scrollLeft: target.scrollLeft ?? null,
                scrollHeight: target.scrollHeight ?? null,
                clientHeight: target.clientHeight ?? null,
            };
        }

        window.scrollBy(dx, dy);
        return {
            target: 'window',
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            documentHeight: document.documentElement?.scrollHeight ?? null,
        };
    }, { direction, amount, selector });

    if (result?.error) {
        throw new Error(result.error);
    }

    return {
        scrolled: direction,
        amount,
        selector: selector || null,
        position: result,
    };
});

// ─── Inspection ──────────────────────────────────────────────────────────────

defineTool('snapshot', 'Get current page URL, title, and DOM snapshot', z.object({
    selector: z.string().optional().describe('CSS selector to snapshot (default: body)'),
}), async ({ selector }) => {
    logger.tool('snapshot');
    const page = await getPage();
    const url = page.url();
    const title = await page.title();
    const el = selector || 'body';
    const { text, html, testIds } = await page.evaluate((sel) => {
        const node = document.querySelector(sel);
        if (!node) {
            return { text: '(element not found)', html: '', testIds: [] };
        }

        function simplify(str, max = 160) {
            if (!str) return '';
            const normalized = str.replace(/\s+/g, ' ').trim();
            return normalized.length > max ? normalized.slice(0, max) + '…' : normalized;
        }

        function walk(n, depth = 0) {
            const indent = '  '.repeat(depth);
            if (n.nodeType === Node.TEXT_NODE) {
                const t = n.textContent.trim();
                return t ? `${indent}${t}` : '';
            }
            if (n.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = n.tagName.toLowerCase();
            const role = n.getAttribute('role') || '';
            const ariaLabel = n.getAttribute('aria-label') || '';
            const id = n.id ? `#${n.id}` : '';
            const value = n.value !== undefined && n.value !== '' ? ` value="${n.value}"` : '';

            let header = `${indent}<${tag}${id}`;
            if (role) header += ` role="${role}"`;
            if (ariaLabel) header += ` aria-label="${ariaLabel}"`;
            header += `${value}>`;

            const children = Array.from(n.childNodes)
                .map(c => walk(c, depth + 1))
                .filter(Boolean)
                .join('\n');

            return children ? `${header}\n${children}` : header;
        }

        const snippet = node.outerHTML
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);

        const ids = Array.from(node.querySelectorAll('[data-testid]'))
            .slice(0, 30)
            .map((el) => {
                const value = el.getAttribute('data-testid');
                if (!value) return null;
                const tag = el.tagName.toLowerCase();
                return {
                    selector: `${tag}[data-testid="${value}"]`,
                    dataTestId: value,
                    text: simplify(el.innerText, 160),
                };
            })
            .filter(Boolean);

        return {
            text: walk(node),
            html: snippet,
            testIds: ids,
        };
    }, el);

    return { url, title, snapshot: text.slice(0, 8000), htmlSnippet: html, dataTestIds: testIds };
});

defineTool('readPage', 'Extract clean main content (article body) from the current page as plain text. Use this to read article/post/product-description content. Strips nav/header/footer/ads. Prefer this over snapshot+scroll loops when the task is "read/extract content".', z.object({
    selector: z.string().optional().describe('Optional CSS selector to override auto-detection of the main content container'),
    maxChars: z.number().optional().describe('Max characters of content text to return (default: 20000)'),
    includeLinks: z.boolean().optional().describe('Include list of links found in main content (default: false)'),
}), async ({ selector, maxChars = 20000, includeLinks = false }) => {
    logger.tool('readPage', { selector, maxChars, includeLinks });
    const page = await getPage();
    const url = page.url();
    const title = await page.title();

    const result = await page.evaluate(({ overrideSelector, includeLinks }) => {
        const NOISE_SELECTORS = [
            'script', 'style', 'noscript', 'template',
            'nav', 'header', 'footer', 'aside',
            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
            '.nav', '.navbar', '.navigation', '.menu', '.header', '.footer', '.sidebar',
            '.ads', '.ad', '.advertisement', '.promo', '.cookie', '.banner',
            '.share', '.social', '.subscribe', '.newsletter', '.related', '.recommendations',
            '.comments', '#comments',
        ];

        function pickMainContainer() {
            if (overrideSelector) {
                const forced = document.querySelector(overrideSelector);
                if (forced) return forced;
            }
            const explicit = document.querySelector('article')
                || document.querySelector('main')
                || document.querySelector('[role="main"]')
                || document.querySelector('#content, #main, .content, .main, .post, .article, .entry-content');
            if (explicit) return explicit;

            const candidates = Array.from(document.querySelectorAll('div, section'));
            let best = null;
            let bestScore = 0;
            for (const el of candidates) {
                const text = (el.innerText || '').trim();
                if (text.length < 200) continue;
                const tagCount = el.getElementsByTagName('*').length || 1;
                const score = text.length / Math.sqrt(tagCount);
                if (score > bestScore) {
                    bestScore = score;
                    best = el;
                }
            }
            return best || document.body;
        }

        const container = pickMainContainer();
        if (!container) {
            return { error: 'No main content container found' };
        }

        // Clone so we can strip noise without mutating the live DOM.
        const clone = container.cloneNode(true);
        for (const sel of NOISE_SELECTORS) {
            clone.querySelectorAll(sel).forEach((el) => el.remove());
        }

        const headings = Array.from(clone.querySelectorAll('h1, h2, h3, h4'))
            .map((h) => {
                const text = (h.innerText || '').replace(/\s+/g, ' ').trim();
                return text ? { level: Number(h.tagName.slice(1)), text } : null;
            })
            .filter(Boolean)
            .slice(0, 50);

        const content = (clone.innerText || '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .trim();

        let links = [];
        if (includeLinks) {
            links = Array.from(clone.querySelectorAll('a[href]'))
                .map((a) => {
                    const text = (a.innerText || '').replace(/\s+/g, ' ').trim();
                    const href = a.getAttribute('href') || '';
                    if (!text || !href || href.startsWith('#')) return null;
                    try {
                        const absolute = new URL(href, document.baseURI).href;
                        return { text: text.slice(0, 200), href: absolute };
                    } catch {
                        return { text: text.slice(0, 200), href };
                    }
                })
                .filter(Boolean)
                .slice(0, 100);
        }

        const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;

        return {
            containerTag: container.tagName.toLowerCase(),
            containerSelector: overrideSelector || null,
            content,
            fullLength: content.length,
            headings,
            links,
            wordCount,
        };
    }, { overrideSelector: selector || null, includeLinks });

    if (result?.error) {
        throw new Error(result.error);
    }

    let content = result.content || '';
    let truncated = false;
    if (content.length > maxChars) {
        content = content.slice(0, maxChars) + '…';
        truncated = true;
    }

    return {
        url,
        title,
        containerTag: result.containerTag,
        containerSelector: result.containerSelector,
        content,
        fullLength: result.fullLength,
        truncated,
        wordCount: result.wordCount,
        headings: result.headings,
        ...(includeLinks ? { links: result.links } : {}),
    };
});

defineTool('screenshot', 'Take a screenshot of the current page', z.object({
    fullPage: z.boolean().optional().describe('Capture full scrollable page'),
    selector: z.string().optional().describe('CSS selector to screenshot'),
}), async ({ fullPage = false, selector }) => {
    logger.tool('screenshot', { fullPage, selector });
    const page = await getPage();
    let buffer;
    if (selector) {
        const el = await page.waitForSelector(selector, { timeout: 10000 });
        buffer = await el.screenshot({ encoding: 'base64' });
    } else {
        buffer = await page.screenshot({ fullPage, encoding: 'base64' });
    }
    return { screenshot: buffer, mimeType: 'image/png' };
});

defineTool('getConsoleLogs', 'Get captured browser console logs', z.object({
    clear: z.boolean().optional().describe('Clear logs after retrieval'),
}), async ({ clear = false }) => {
    logger.tool('getConsoleLogs');
    const page = await getPage();
    const logs = [...(page._consoleLogs || [])];
    if (clear) page._consoleLogs = [];
    return { logs, count: logs.length };
});

defineTool('evaluate', 'Execute JavaScript in the browser context', z.object({
    expression: z.string().describe('JavaScript code to execute'),
}), async ({ expression }) => {
    logger.tool('evaluate →', expression.slice(0, 100));
    const page = await getPage();
    try {
        const result = await page.evaluate(expression);
        return { result };
    } catch (err) {
        return { error: err.message };
    }
});

// ─── Network ─────────────────────────────────────────────────────────────────

defineTool('enableNetworkCapture', 'Enable/disable network request capturing', z.object({
    enabled: z.boolean().describe('Enable or disable network capturing'),
}), async ({ enabled }) => {
    logger.tool('enableNetworkCapture →', enabled);
    const page = await getPage();

    if (enabled && !page._networkCapture) {
        page._networkCapture = true;
        page._networkRequests = [];
        page._reqHandler = (req) => {
            page._networkRequests.push({
                url: req.url(),
                method: req.method(),
                resourceType: req.resourceType(),
                timestamp: Date.now(),
            });
        };
        page._resHandler = (res) => {
            const req = page._networkRequests.find(r => r.url === res.url());
            if (req) {
                req.status = res.status();
                req.headers = res.headers();
            }
        };
        page.on('request', page._reqHandler);
        page.on('response', page._resHandler);
    } else if (!enabled && page._networkCapture) {
        page._networkCapture = false;
        page.off('request', page._reqHandler);
        page.off('response', page._resHandler);
    }

    return { networkCapture: enabled };
});

defineTool('getNetworkRequests', 'Get captured network requests', z.object({
    clear: z.boolean().optional().describe('Clear requests after retrieval'),
    filter: z.string().optional().describe('Filter by URL substring'),
}), async ({ clear = false, filter }) => {
    logger.tool('getNetworkRequests');
    const page = await getPage();
    let reqs = [...(page._networkRequests || [])];
    if (filter) {
        reqs = reqs.filter(r => r.url.includes(filter));
    }
    if (clear) page._networkRequests = [];
    return { requests: reqs.slice(-100), count: reqs.length };
});

// ─── Performance ─────────────────────────────────────────────────────────────

defineTool('getPerformanceMetrics', 'Get Chrome performance metrics', z.object({}), async () => {
    logger.tool('getPerformanceMetrics');
    const page = await getPage();
    const client = await page.createCDPSession();
    await client.send('Performance.enable');
    const { metrics } = await client.send('Performance.getMetrics');
    await client.detach();
    const result = {};
    for (const m of metrics) {
        result[m.name] = m.value;
    }
    return { metrics: result };
});

defineTool('startTrace', 'Start a performance trace', z.object({
    categories: z.array(z.string()).optional().describe('Trace categories (default: common set)'),
}), async ({ categories }) => {
    logger.tool('startTrace');
    const page = await getPage();
    const cats = categories || [
        'devtools.timeline',
        'v8.execute',
        'blink.user_timing',
    ];
    await page.tracing.start({ categories: cats });
    return { tracing: 'started', categories: cats };
});

defineTool('stopTrace', 'Stop performance trace and return data', z.object({}), async () => {
    logger.tool('stopTrace');
    const page = await getPage();
    let buffer;
    try {
        buffer = await page.tracing.stop();
    } catch (err) {
        const message = err?.message || String(err);
        if (message.toLowerCase().includes('tracing is not started')) {
            return {
                tracing: 'not_running',
                eventCount: 0,
                durationMs: 0,
                summary: 'Tracing was not active when stopTrace was called.',
            };
        }
        logger.tool('stopTrace stop error →', message);
        return {
            tracing: 'error',
            eventCount: 0,
            durationMs: 0,
            summary: 'Tracing could not be stopped.',
            error: message,
        };
    }

    if (!buffer || buffer.length === 0) {
        return {
            tracing: 'stopped',
            eventCount: 0,
            durationMs: 0,
            summary: 'Tracing stopped, but no data was collected.',
        };
    }

    let text;
    try {
        const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
        const payload = isGzip ? gunzipSync(buffer) : buffer;
        text = payload.toString('utf8')
            .replace(/^\uFEFF/, '')
            .trimStart();
        const firstBrace = text.indexOf('{');
        if (firstBrace > 0) {
            text = text.slice(firstBrace);
        }
    } catch (err) {
        logger.tool('stopTrace decode error →', err.message);
        return {
            tracing: 'stopped',
            eventCount: 0,
            durationMs: 0,
            summary: 'Trace captured but the payload could not be decoded.',
            error: err.message,
        };
    }

    try {
        const trace = JSON.parse(text);
        const events = trace.traceEvents || [];
        const duration = events.length > 0
            ? (events[events.length - 1].ts - events[0].ts) / 1000
            : 0;
        return {
            tracing: 'stopped',
            eventCount: events.length,
            durationMs: Math.round(duration),
            summary: `${events.length} events over ${Math.round(duration)}ms`,
        };
    } catch (err) {
        logger.tool('stopTrace parse error →', err.message);
        return {
            tracing: 'stopped',
            eventCount: 0,
            durationMs: 0,
            summary: 'Trace captured but could not be parsed as JSON.',
            error: err.message,
        };
    }
});

// ─── Accessibility ───────────────────────────────────────────────────────────

defineTool('getAccessibilityTree', 'Get the accessibility tree of the page', z.object({
    depth: z.number().optional().describe('Max depth to traverse (default: 5)'),
}), async ({ depth = 5 }) => {
    logger.tool('getAccessibilityTree');
    const page = await getPage();
    const snapshot = await page.accessibility.snapshot();

    function trim(node, d) {
        if (!node || d <= 0) return null;
        const result = { role: node.role, name: node.name };
        if (node.value) result.value = node.value;
        if (node.description) result.description = node.description;
        if (node.children && node.children.length > 0) {
            result.children = node.children
                .map(c => trim(c, d - 1))
                .filter(Boolean);
        }
        return result;
    }

    const tree = trim(snapshot, depth);
    return { accessibilityTree: tree };
});

// ─── Browser lifecycle ───────────────────────────────────────────────────────

defineTool('closeBrowser', 'Close the browser instance', z.object({}), async () => {
    logger.tool('closeBrowser');
    await closeBrowser();
    return { closed: true };
});

defineTool('wait', 'Wait for a specified duration', z.object({
    ms: z.number().describe('Milliseconds to wait'),
}), async ({ ms }) => {
    logger.tool('wait →', ms);
    await new Promise(resolve => setTimeout(resolve, ms));
    return { waited: ms };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get all tool names.
 */
export function getToolNames() {
    return Object.keys(tools);
}

/**
 * Get tool definitions for MCP registration (with JSON-compatible schemas).
 */
export function getToolDefinitions() {
    return Object.values(tools).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
    }));
}

/**
 * Execute a tool by name with validated params.
 */
export async function executeTool(name, params = {}) {
    const tool = tools[name];
    if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
    }
    const parsed = tool.schema.parse(params);
    const preDelay = 100 + Math.floor(Math.random() * 250);
    await new Promise(resolve => setTimeout(resolve, preDelay));
    const result = await tool.handler(parsed);
    return result;
}
