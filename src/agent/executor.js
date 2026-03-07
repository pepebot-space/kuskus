import { createPageDomain } from '../cdp/domains/page.js';
import { createDOMDomain } from '../cdp/domains/dom.js';
import { createInputDomain } from '../cdp/domains/input.js';
import { createRuntimeDomain } from '../cdp/domains/runtime.js';
import { createTargetDomain } from '../cdp/domains/target.js';
import logger from '../utils/logger.js';

/**
 * Executes agent tool calls against the browser via CDP.
 */
export class Executor {
  #session;

  constructor(sessionManager) {
    this.#session = sessionManager;
  }

  async #client() {
    return this.#session.getActiveSession();
  }

  async execute(toolName, params) {
    logger.debug({ tool: toolName, params }, 'Executing tool');

    const client = await this.#client();
    const page = createPageDomain(client, this.#session.capabilities);
    const dom = createDOMDomain(client);
    const input = createInputDomain(client);
    const runtime = createRuntimeDomain(client);
    const target = createTargetDomain(this.#session);

    switch (toolName) {
      case 'navigate': {
        await page.navigate(params.url);
        return `Navigated to ${params.url}`;
      }

      case 'screenshot': {
        const data = await page.screenshot({ fullPage: params.full_page ?? false });
        return { type: 'screenshot', data };
      }

      case 'get_page_content': {
        const { htmlToReadableText } = await import('../utils/dom-to-text.js');
        const html = await runtime.evaluate('document.documentElement.outerHTML');
        if (params.format === 'html') return html;
        return htmlToReadableText(html);
      }

      case 'get_url': {
        return page.getURL();
      }

      case 'click': {
        const nodeId = await this.#resolveSelector(dom, params.selector);
        await dom.scrollIntoView(nodeId);
        const { x, y } = await dom.getCenter(nodeId);
        await input.click(x, y);
        return `Clicked "${params.selector}"`;
      }

      case 'click_coords': {
        await input.click(params.x, params.y);
        return `Clicked at (${params.x}, ${params.y})`;
      }

      case 'type_text': {
        const selectors = buildSelectorVariants(params.selector);
        const selectorsCode = JSON.stringify(selectors);
        const text = JSON.stringify(params.text);
        const clear = params.clear_first !== false;
        // Use JS to set value + fire events — more reliable than simulated keystrokes
        const result = await runtime.evaluate(`(function(){
          const selectors = ${selectorsCode};
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;
            el.focus?.();
            ${clear ? 'if ("value" in el) { el.value = ""; } else if (el.isContentEditable) { el.textContent = ""; }' : ''}
            if ("value" in el) {
              el.value = ${text};
            } else if (el.isContentEditable) {
              el.textContent = ${text};
            } else {
              continue;
            }
            el.dispatchEvent?.(new Event('input',  { bubbles: true }));
            el.dispatchEvent?.(new Event('change', { bubbles: true }));
            return el.value ?? el.textContent ?? '';
          }
          return 'NOT_FOUND';
        })()`);
        if (result === 'NOT_FOUND') throw new Error(`Element not found: ${params.selector}`);
        return `Typed "${params.text}" into "${params.selector}"`;
      }

      case 'key_press': {
        await input.keyPress(params.key);
        return `Pressed key: ${params.key}`;
      }

      case 'scroll': {
        const amount = params.amount ?? 500;
        const deltaY = params.direction === 'up' ? -amount : amount;
        await input.scroll(400, 300, 0, deltaY);
        return `Scrolled ${params.direction} by ${amount}px`;
      }

      case 'hover': {
        const nodeId = await this.#resolveSelector(dom, params.selector);
        await dom.scrollIntoView(nodeId);
        const { x, y } = await dom.getCenter(nodeId);
        await input.hover(x, y);
        return `Hovered over "${params.selector}"`;
      }

      case 'evaluate_js': {
        const result = await runtime.evaluate(params.script);
        return typeof result === 'object' ? JSON.stringify(result) : String(result ?? 'undefined');
      }

      case 'wait_for_navigation': {
        const timeout = Math.min(params.timeout_ms ?? 10_000, 60_000);
        const regex = params.url_regex ? new RegExp(params.url_regex) : null;
        const startUrl = await page.getURL().catch(() => '');
        const deadline = Date.now() + timeout;
        let currentUrl = startUrl;

        while (Date.now() < deadline) {
          await sleep(300);
          currentUrl = await page.getURL().catch(() => currentUrl);
          const urlChanged = currentUrl && currentUrl !== startUrl;
          const matches = regex ? regex.test(currentUrl) : true;
          if (urlChanged && matches) {
            return `Navigation detected: ${currentUrl}`;
          }
        }

        throw new Error(`Navigation did not complete within ${timeout}ms`);
      }

      case 'extract_serp_results': {
        const limit = Math.max(1, Math.min(Number.isFinite(params.limit) ? Number(params.limit) : 5, 10));
        const raw = await runtime.evaluate(`(() => {
          const max = ${limit};
          const seen = new Set();
          const results = [];
          const addResult = (titleEl, linkEl, snippetEl) => {
            if (!titleEl || !linkEl) return;
            const url = linkEl.href || '';
            const title = titleEl.innerText?.trim();
            if (!url || !title || seen.has(url)) return;
            seen.add(url);
            const snippet = snippetEl?.innerText?.trim?.() || '';
            results.push({ title, url, snippet });
          };
          const snippetSelector = 'div.VwiC3b, span.aCOpRe, div[data-sncf]';
          const containerSelector = '#search div.g, #search div[data-sokoban-container="true"], #search div[jscontroller="SC7lYd"]';
          const sections = Array.from(document.querySelectorAll(containerSelector));
          for (const section of sections) {
            const link = section.querySelector('a');
            const title = section.querySelector('h3');
            if (!link || !title) continue;
            const snippet = section.querySelector(snippetSelector);
            addResult(title, link, snippet);
            if (results.length >= max) break;
          }
          if (results.length < max) {
            const extra = Array.from(document.querySelectorAll('#search a h3'));
            for (const title of extra) {
              const link = title.closest('a');
              const container = title.closest(containerSelector) || title.parentElement?.parentElement;
              const snippet = container?.querySelector(snippetSelector);
              addResult(title, link, snippet);
              if (results.length >= max) break;
            }
          }
          return JSON.stringify(results);
        })()`);
        let parsed;
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          parsed = [];
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('No search results could be extracted');
        }
        return JSON.stringify(parsed.slice(0, limit), null, 2);
      }

      case 'wait': {
        const ms = Math.min(params.ms ?? 1000, 10_000);
        await sleep(ms);
        return `Waited ${ms}ms`;
      }

      case 'get_element_info': {
        const nodeId = await this.#resolveSelector(dom, params.selector);
        const [attrs, text] = await Promise.all([
          dom.getAttributes(nodeId),
          runtime.evaluate(
            `document.querySelector(${JSON.stringify(params.selector)})?.innerText?.trim() ?? ''`
          ),
        ]);
        return JSON.stringify({ attributes: attrs, text });
      }

      case 'select_option': {
        const result = await runtime.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (!el) return 'Element not found';
            const opts = Array.from(el.options);
            const opt = opts.find(o => o.value === ${JSON.stringify(params.value)} || o.text === ${JSON.stringify(params.value)});
            if (!opt) return 'Option not found: ' + ${JSON.stringify(params.value)};
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return 'Selected: ' + opt.text;
          })()
        `);
        return result;
      }

      case 'set_checkbox': {
        await runtime.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (el) {
              el.checked = ${params.checked};
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
        return `Set checkbox "${params.selector}" to ${params.checked}`;
      }

      case 'go_back': {
        await page.goBack();
        return 'Navigated back';
      }

      case 'go_forward': {
        await page.goForward();
        return 'Navigated forward';
      }

      case 'new_tab': {
        await target.newTab(params.url);
        return `Opened new tab${params.url ? ` at ${params.url}` : ''}`;
      }

      case 'list_tabs': {
        const tabs = await target.listTabs();
        return JSON.stringify(tabs);
      }

      case 'switch_tab': {
        await target.switchTab(params.target_id);
        return `Switched to tab ${params.target_id}`;
      }

      case 'close_tab': {
        const tabs = await target.listTabs();
        const id = params.target_id ?? tabs[tabs.length - 1]?.id;
        if (id) await target.closeTab(id);
        return `Closed tab ${id}`;
      }

      case 'extract_data': {
        const result = await runtime.evaluate(params.script);
        return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
      }

      case 'finish': {
        return { type: 'finish', result: params.result, data: params.data };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async #resolveSelector(dom, selector, retries = 1) {
    for (let i = 0; i <= retries; i++) {
      const nodeId = await dom.querySelector(selector);
      if (nodeId) return nodeId;
      if (i < retries) await sleep(1000);
    }
    throw new Error(`Element not found: ${selector}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSelectorVariants(selector) {
  const variants = new Set();
  if (selector) variants.add(selector);

  const trimmed = selector?.trim() ?? '';
  if (trimmed.startsWith('input')) {
    variants.add(trimmed.replace(/^input/i, 'textarea'));
  }
  if (trimmed.startsWith('textarea')) {
    variants.add(trimmed.replace(/^textarea/i, 'input'));
  }

  const nameMatch = trimmed.match(/\[name\s*=\s*(['"])([^'"\]]+)\1\]/i);
  if (nameMatch) {
    variants.add(`[name="${nameMatch[2]}"]`);
  }

  return Array.from(variants).filter(Boolean);
}
