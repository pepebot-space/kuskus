import { SessionManager } from '../cdp/session.js';
import { Executor } from '../agent/executor.js';
import { createPageDomain } from '../cdp/domains/page.js';
import { createRuntimeDomain } from '../cdp/domains/runtime.js';
import { htmlToReadableText } from '../utils/dom-to-text.js';

let session = null;
let executor = null;

async function getSession() {
  if (!session) {
    const cdpUrl = new URL(process.env.CDP_URL || 'ws://localhost:9222');
    session = new SessionManager({ host: cdpUrl.hostname, port: Number(cdpUrl.port) || 9222 });
    await session.connect();
    executor = new Executor(session);
  }
  return { session, executor };
}

// Map MCP tool names → executor tool names + param builders
const TOOL_MAP = {
  browser_navigate:   (a) => ['navigate',     { url: a.url }],
  browser_click:      (a) => ['click',         { selector: a.selector }],
  browser_type:       (a) => ['type_text',     { selector: a.selector, text: a.text }],
  browser_key_press:  (a) => ['key_press',     { key: a.key }],
  browser_scroll:     (a) => ['scroll',        { direction: a.direction, amount: a.amount }],
  browser_hover:      (a) => ['hover',         { selector: a.selector }],
  browser_evaluate:   (a) => ['evaluate_js',   { script: a.script }],
  browser_extract:    (a) => ['extract_data',  { script: a.script }],
  browser_get_url:    ()  => ['get_url',       {}],
  browser_go_back:    ()  => ['go_back',       {}],
  browser_go_forward: ()  => ['go_forward',    {}],
  browser_new_tab:    (a) => ['new_tab',       { url: a.url }],
  browser_close_tab:  (a) => ['close_tab',     { target_id: a.target_id }],
  browser_list_tabs:  ()  => ['list_tabs',     {}],
  browser_switch_tab: (a) => ['switch_tab',    { target_id: a.target_id }],
  browser_select:     (a) => ['select_option', { selector: a.selector, value: a.value }],
  browser_checkbox:   (a) => ['set_checkbox',  { selector: a.selector, checked: a.checked }],
  browser_wait:       (a) => ['wait',          { ms: a.ms }],
  browser_element_info: (a) => ['get_element_info', { selector: a.selector }],
};

export async function handleToolCall(name, args) {
  const { session: sm, executor: exec } = await getSession();

  // Screenshot — returns image content block
  if (name === 'browser_screenshot') {
    const client = await sm.getActiveSession();
    const page = createPageDomain(client, sm.capabilities);
    const data = await page.screenshot({ fullPage: args.full_page ?? false });
    if (!data) return { content: [{ type: 'text', text: 'Screenshot not supported by this browser.' }] };
    return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
  }

  // Page content — returns text
  if (name === 'browser_get_content') {
    const client = await sm.getActiveSession();
    const runtime = createRuntimeDomain(client);
    const html = await runtime.evaluate('document.documentElement.outerHTML');
    return { content: [{ type: 'text', text: htmlToReadableText(html) }] };
  }

  // All other tools via executor
  const mapFn = TOOL_MAP[name];
  if (!mapFn) throw new Error(`Unknown MCP tool: ${name}`);

  const [toolName, params] = mapFn(args);
  const result = await exec.execute(toolName, params);
  const text = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
  return { content: [{ type: 'text', text }] };
}

export async function handleResourceRead(uri) {
  const { session: sm } = await getSession();
  const client = await sm.getActiveSession();
  const page = createPageDomain(client, sm.capabilities);
  const runtime = createRuntimeDomain(client);

  if (uri === 'browser://screenshot') {
    const data = await page.screenshot();
    if (!data) return { contents: [{ uri, mimeType: 'text/plain', text: 'Screenshot not supported.' }] };
    return { contents: [{ uri, mimeType: 'image/png', blob: data }] };
  }
  if (uri === 'browser://page/content') {
    const html = await runtime.evaluate('document.documentElement.outerHTML');
    return { contents: [{ uri, mimeType: 'text/plain', text: htmlToReadableText(html) }] };
  }
  if (uri === 'browser://page/url') {
    const url = await page.getURL();
    return { contents: [{ uri, mimeType: 'text/plain', text: url }] };
  }
  if (uri === 'browser://tabs') {
    const targets = await sm.listTargets();
    const tabs = targets
      .filter((t) => t.type === 'page')
      .map((t) => ({ id: t.id, url: t.url, title: t.title }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(tabs, null, 2) }] };
  }

  throw new Error(`Unknown resource: ${uri}`);
}
