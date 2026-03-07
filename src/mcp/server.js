import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { handleToolCall, handleResourceRead } from './handlers.js';
import logger from '../utils/logger.js';

export async function startMCPServer() {
  const server = new McpServer({
    name: 'kuskus',
    version: '0.1.0',
  });

  // ── Navigation ─────────────────────────────────────────────────────────────

  server.tool('browser_navigate',
    'Navigate the browser to a URL and wait for the page to load.',
    { url: z.string().describe('Absolute URL to navigate to.') },
    (args) => handleToolCall('browser_navigate', args)
  );

  server.tool('browser_go_back',
    'Go back in the browser history.',
    {},
    (args) => handleToolCall('browser_go_back', args)
  );

  server.tool('browser_go_forward',
    'Go forward in the browser history.',
    {},
    (args) => handleToolCall('browser_go_forward', args)
  );

  server.tool('browser_get_url',
    'Get the current page URL.',
    {},
    (args) => handleToolCall('browser_get_url', args)
  );

  // ── Observation ────────────────────────────────────────────────────────────

  server.tool('browser_screenshot',
    'Capture the current browser viewport as a PNG screenshot. Use this to see the current state of the page.',
    { full_page: z.boolean().optional().describe('Capture the full scrollable page instead of just the viewport.') },
    (args) => handleToolCall('browser_screenshot', args)
  );

  server.tool('browser_get_content',
    'Get the readable text content of the current page. Useful for extracting information without a screenshot.',
    {},
    (args) => handleToolCall('browser_get_content', args)
  );

  server.tool('browser_element_info',
    'Get the attributes and text content of an element.',
    { selector: z.string().describe('CSS selector of the element.') },
    (args) => handleToolCall('browser_element_info', args)
  );

  // ── Interaction ────────────────────────────────────────────────────────────

  server.tool('browser_click',
    'Click an element on the page using a CSS selector.',
    { selector: z.string().describe('CSS selector of the element to click.') },
    (args) => handleToolCall('browser_click', args)
  );

  server.tool('browser_type',
    'Type text into an input or textarea element. Clears existing content first.',
    {
      selector: z.string().describe('CSS selector of the input or textarea.'),
      text: z.string().describe('Text to type.'),
    },
    (args) => handleToolCall('browser_type', args)
  );

  server.tool('browser_key_press',
    'Press a keyboard key. Common keys: Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace.',
    { key: z.string().describe('DOM key name e.g. Enter, Tab, Escape.') },
    (args) => handleToolCall('browser_key_press', args)
  );

  server.tool('browser_scroll',
    'Scroll the page up or down.',
    {
      direction: z.enum(['up', 'down']),
      amount: z.number().optional().describe('Pixels to scroll. Default 500.'),
    },
    (args) => handleToolCall('browser_scroll', args)
  );

  server.tool('browser_hover',
    'Hover the mouse over an element (useful for dropdown menus).',
    { selector: z.string().describe('CSS selector of the element to hover over.') },
    (args) => handleToolCall('browser_hover', args)
  );

  server.tool('browser_select',
    'Select an option from a <select> dropdown element.',
    {
      selector: z.string().describe('CSS selector of the <select> element.'),
      value: z.string().describe('Option value or visible label text to select.'),
    },
    (args) => handleToolCall('browser_select', args)
  );

  server.tool('browser_checkbox',
    'Check or uncheck a checkbox or radio input.',
    {
      selector: z.string().describe('CSS selector of the checkbox/radio input.'),
      checked: z.boolean().describe('true to check, false to uncheck.'),
    },
    (args) => handleToolCall('browser_checkbox', args)
  );

  // ── JavaScript ─────────────────────────────────────────────────────────────

  server.tool('browser_evaluate',
    'Execute JavaScript in the page context and return the result. Use for complex DOM queries or interactions.',
    { script: z.string().describe('JavaScript expression or statement to evaluate.') },
    (args) => handleToolCall('browser_evaluate', args)
  );

  server.tool('browser_extract',
    'Extract structured data from the page by evaluating a JavaScript expression that returns an object or array.',
    { script: z.string().describe('JS expression returning the data to extract, e.g. Array.from(document.querySelectorAll("h2")).map(el => el.textContent)') },
    (args) => handleToolCall('browser_extract', args)
  );

  // ── Tabs ───────────────────────────────────────────────────────────────────

  server.tool('browser_list_tabs',
    'List all open browser tabs with their IDs, URLs and titles.',
    {},
    (args) => handleToolCall('browser_list_tabs', args)
  );

  server.tool('browser_new_tab',
    'Open a new browser tab.',
    { url: z.string().optional().describe('URL to open in the new tab. Opens about:blank if omitted.') },
    (args) => handleToolCall('browser_new_tab', args)
  );

  server.tool('browser_switch_tab',
    'Switch to a different browser tab by its target ID.',
    { target_id: z.string().describe('Target ID from browser_list_tabs.') },
    (args) => handleToolCall('browser_switch_tab', args)
  );

  server.tool('browser_close_tab',
    'Close a browser tab.',
    { target_id: z.string().optional().describe('Target ID to close. Closes the active tab if omitted.') },
    (args) => handleToolCall('browser_close_tab', args)
  );

  // ── Utility ────────────────────────────────────────────────────────────────

  server.tool('browser_wait',
    'Wait for a number of milliseconds (max 10 seconds).',
    { ms: z.number().describe('Milliseconds to wait.') },
    (args) => handleToolCall('browser_wait', args)
  );

  // ── Resources ──────────────────────────────────────────────────────────────

  server.resource('browser_screenshot_resource',
    'browser://screenshot',
    { mimeType: 'image/png' },
    (uri) => handleResourceRead(uri.href)
  );

  server.resource('browser_page_content',
    'browser://page/content',
    { mimeType: 'text/plain' },
    (uri) => handleResourceRead(uri.href)
  );

  server.resource('browser_page_url',
    'browser://page/url',
    { mimeType: 'text/plain' },
    (uri) => handleResourceRead(uri.href)
  );

  server.resource('browser_tabs',
    'browser://tabs',
    { mimeType: 'application/json' },
    (uri) => handleResourceRead(uri.href)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Kuskus MCP server started (stdio)');
}
