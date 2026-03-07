/**
 * Tool definitions for the Kuskus agent.
 * Each entry has: name, description, input_schema (JSON Schema), and a handler factory.
 */

export const TOOL_DEFINITIONS = [
  {
    name: 'navigate',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'screenshot',
    description: 'Capture the current browser viewport as a PNG screenshot. Returns base64 image.',
    input_schema: {
      type: 'object',
      properties: {
        full_page: { type: 'boolean', description: 'Capture the full scrollable page.' },
      },
    },
  },
  {
    name: 'get_page_content',
    description: 'Get the readable text content of the current page (HTML converted to text/markdown).',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['text', 'html'], description: 'Output format.' },
      },
    },
  },
  {
    name: 'get_url',
    description: 'Get the current page URL.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click an element on the page using a CSS selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click.' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'click_coords',
    description: 'Click at specific x, y coordinates on the page.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'type_text',
    description: 'Click an input element and type text into it. Clears existing content first.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input/textarea.' },
        text: { type: 'string', description: 'Text to type.' },
        clear_first: { type: 'boolean', description: 'Select all and delete before typing. Default true.' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'key_press',
    description: 'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'DOM key name e.g. Enter, Tab, Escape.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
        amount: { type: 'number', description: 'Pixels to scroll. Default 500.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'hover',
    description: 'Hover over an element by CSS selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'evaluate_js',
    description: 'Execute JavaScript in the page context and return the result. Use for complex DOM queries or interactions.',
    input_schema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript expression or statement to evaluate.' },
      },
      required: ['script'],
    },
  },
  {
    name: 'wait_for_navigation',
    description: 'Wait until the page navigates to a different URL (optionally matching a pattern).',
    input_schema: {
      type: 'object',
      properties: {
        timeout_ms: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default 10000, max 60000).',
        },
        url_regex: {
          type: 'string',
          description: 'Optional JavaScript regular expression that the new URL must match.',
        },
      },
    },
  },
  {
    name: 'extract_serp_results',
    description: 'Extract top search results (title, URL, snippet) from the current Google results page.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5, max 10).',
        },
      },
    },
  },
  {
    name: 'wait',
    description: 'Wait for a specified number of milliseconds.',
    input_schema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (max 10000).' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'get_element_info',
    description: 'Get attributes and text content of an element.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'select_option',
    description: 'Select an option in a <select> element.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        value: { type: 'string', description: 'Option value or visible label text.' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'set_checkbox',
    description: 'Check or uncheck a checkbox or radio input.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        checked: { type: 'boolean' },
      },
      required: ['selector', 'checked'],
    },
  },
  {
    name: 'go_back',
    description: 'Navigate back in browser history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'go_forward',
    description: 'Navigate forward in browser history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'new_tab',
    description: 'Open a new browser tab.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open in the new tab.' },
      },
    },
  },
  {
    name: 'list_tabs',
    description: 'List all open browser tabs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_tab',
    description: 'Switch to a different browser tab.',
    input_schema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: 'Target ID from list_tabs.' },
      },
      required: ['target_id'],
    },
  },
  {
    name: 'close_tab',
    description: 'Close a browser tab.',
    input_schema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: 'Target ID to close. Closes active tab if omitted.' },
      },
    },
  },
  {
    name: 'extract_data',
    description: 'Extract structured data from the current page using a JavaScript extractor expression.',
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'JS expression returning an object/array with the data you want to extract.',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'finish',
    description: 'Signal that the task is complete. Provide a summary of what was accomplished.',
    input_schema: {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'Summary of the completed task and any results.' },
        data: { description: 'Optional structured data returned from the task (any type).' },
      },
      required: ['result'],
    },
  },
];
