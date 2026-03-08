/**
 * Debug logger with colored, categorized output.
 *
 * Categories:
 *   [PLAN]  — LLM planning decisions
 *   [TOOL]  — tool invocations and results
 *   [STEP]  — multi-step agent progress
 *   [CDP]   — raw CDP / Puppeteer events
 *   [MCP]   — MCP server events
 *   [INFO]  — general information
 *   [ERROR] — errors
 */

import { config } from '../config.js';

const COLORS = {
    PLAN: '\x1b[35m',   // magenta
    TOOL: '\x1b[36m',   // cyan
    STEP: '\x1b[33m',   // yellow
    CDP: '\x1b[90m',   // gray
    MCP: '\x1b[34m',   // blue
    INFO: '\x1b[32m',   // green
    ERROR: '\x1b[31m',   // red
    RESET: '\x1b[0m',
};

function timestamp() {
    return new Date().toISOString().slice(11, 23);
}

function log(category, ...args) {
    if (!config.debug && category !== 'ERROR') return;
    const color = COLORS[category] || COLORS.INFO;
    const prefix = `${COLORS.CDP}${timestamp()}${COLORS.RESET} ${color}[${category}]${COLORS.RESET}`;
    console.error(prefix, ...args);
}

export const logger = {
    plan: (...args) => log('PLAN', ...args),
    tool: (...args) => log('TOOL', ...args),
    step: (...args) => log('STEP', ...args),
    cdp: (...args) => log('CDP', ...args),
    mcp: (...args) => log('MCP', ...args),
    info: (...args) => log('INFO', ...args),
    error: (...args) => log('ERROR', ...args),

    /** Force-log regardless of debug flag (for CLI output) */
    print: (...args) => console.error(...args),

    /** Pretty-print an object */
    dump: (category, label, obj) => {
        log(category, label);
        if (config.debug) {
            console.error(JSON.stringify(obj, null, 2));
        }
    },
};
