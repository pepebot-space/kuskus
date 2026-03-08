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
import { getPage, getCDPSession, closeBrowser } from './browser.js';
import { logger } from '../utils/logger.js';

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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    return {
        url: page.url(),
        title,
        status: response?.status() ?? null,
    };
});

defineTool('goBack', 'Go back in browser history', z.object({}), async () => {
    logger.tool('goBack');
    const page = await getPage();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    return { url: page.url(), title: await page.title() };
});

defineTool('goForward', 'Go forward in browser history', z.object({}), async () => {
    logger.tool('goForward');
    const page = await getPage();
    await page.goForward({ waitUntil: 'domcontentloaded' });
    return { url: page.url(), title: await page.title() };
});

defineTool('reload', 'Reload the current page', z.object({}), async () => {
    logger.tool('reload');
    const page = await getPage();
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await page.waitForSelector(selector, { timeout: 10000 });
    if (clearFirst) {
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
    }
    await page.type(selector, text);
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
    const scrollCode = selector
        ? `document.querySelector('${selector}').scrollBy(${direction === 'left' ? -amount : direction === 'right' ? amount : 0}, ${direction === 'up' ? -amount : direction === 'down' ? amount : 0})`
        : `window.scrollBy(${direction === 'left' ? -amount : direction === 'right' ? amount : 0}, ${direction === 'up' ? -amount : direction === 'down' ? amount : 0})`;
    await page.evaluate(scrollCode);
    return { scrolled: direction, amount };
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
    const text = await page.evaluate((sel) => {
        const node = document.querySelector(sel);
        if (!node) return '(element not found)';

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

        return walk(node);
    }, el);

    return { url, title, snapshot: text.slice(0, 8000) };
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
    const buffer = await page.tracing.stop();
    const trace = JSON.parse(buffer.toString());
    // Extract summary metrics
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
    const result = await tool.handler(parsed);
    return result;
}
