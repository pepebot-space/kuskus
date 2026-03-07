import { SessionManager } from '../cdp/session.js';
import { createPageDomain } from '../cdp/domains/page.js';
import { createRuntimeDomain } from '../cdp/domains/runtime.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';
import { AgentMemory } from './memory.js';
import { htmlToReadableText } from '../utils/dom-to-text.js';
import { saveScreenshot, screenshotFilename } from '../utils/screenshot.js';
import logger from '../utils/logger.js';

/**
 * Kuskus Agent — orchestrates the plan → execute → observe loop.
 */
export class KuskusAgent {
  #session;
  #planner;
  #executor;
  #memory;
  #maxSteps;
  #screenshotDir;
  #onStep;

  constructor({
    cdpUrl = process.env.CDP_URL || 'ws://localhost:9222',
    provider = process.env.AGENT_PROVIDER || null,
    model = process.env.AGENT_MODEL || 'claude-sonnet-4-6',
    apiKey = null,
    maxSteps = Number(process.env.AGENT_MAX_STEPS) || 20,
    maxTokens = Number(process.env.AGENT_MAX_TOKENS) || 4096,
    includeScreenshot = process.env.AGENT_INCLUDE_SCREENSHOT !== 'false',
    screenshotDir = null,
    onStep = null,
  } = {}) {
    const url = new URL(cdpUrl);
    this.#session = new SessionManager({ host: url.hostname, port: Number(url.port) || 9222 });
    this.#planner = new Planner({ provider, model, apiKey, maxTokens, includeScreenshot });
    this.#executor = new Executor(this.#session);
    this.#memory = new AgentMemory({ windowSize: 10 });
    this.#maxSteps = maxSteps;
    this.#screenshotDir = screenshotDir;
    this.#onStep = onStep;
  }

  async connect() {
    await this.#session.connect();
    return this;
  }

  async close() {
    await this.#session.close();
  }

  /**
   * Run a natural language task to completion.
   * @param {string} task
   * @returns {Promise<{ result: string, data?: any, steps: number }>}
   */
  async run(task) {
    this.#memory.clear();
    let step = 0;
    const recentTools = []; // last N {toolName, key} for loop detection

    const plan = await this.#planner.plan(task);
    if (plan) {
      logger.debug({ plan }, 'Task plan generated');
      this.#onStep?.({ step: 0, tool: 'plan', params: { plan }, url: null });
    }

    for (;;) {
      step++;
      if (step > this.#maxSteps) {
        return { result: `Stopped after ${this.#maxSteps} steps without completing.`, steps: step };
      }

      // Observe current state
      const client = await this.#session.getActiveSession();
      const page = createPageDomain(client, this.#session.capabilities);
      const runtime = createRuntimeDomain(client);

      const [currentUrl, screenshot, html] = await Promise.all([
        page.getURL().catch(() => 'unknown'),
        page.screenshot({ quality: Number(process.env.AGENT_SCREENSHOT_QUALITY) || 80 }).catch(() => null),
        runtime.evaluate('document.documentElement.outerHTML').catch(() => ''),
      ]);

      const pageContent = htmlToReadableText(html);

      // Save screenshot to disk if configured
      if (screenshot && this.#screenshotDir) {
        const filename = screenshotFilename(step);
        await saveScreenshot(screenshot, this.#screenshotDir, filename);
      }

      // Plan next action
      const { toolName, params } = await this.#planner.nextAction({
        task,
        step,
        maxSteps: this.#maxSteps,
        history: this.#memory.toContextString(),
        screenshot,
        pageContent,
        currentUrl,
        plan,
      });

      this.#onStep?.({ step, tool: toolName, params, url: currentUrl });

      // Finish signal
      if (toolName === 'finish') {
        this.#memory.push({ step, tool: 'finish', params, result: params.result });
        return { result: params.result, data: params.data, steps: step };
      }

      // Loop detection — same tool+params called 3 times in a row → force finish
      const toolKey = `${toolName}:${JSON.stringify(params)}`;
      recentTools.push(toolKey);
      if (recentTools.length > 6) recentTools.shift();
      const repeatCount = recentTools.filter((k) => k === toolKey).length;
      if (repeatCount >= 3) {
        logger.warn({ step, toolName, toolKey }, 'Loop detected: same tool called 3 times, stopping');
        return {
          result: `Stopped: detected repeated action "${toolName}" with same parameters ${repeatCount} times. Task may be incomplete.`,
          steps: step,
        };
      }

      // Execute tool
      let result, error;
      try {
        const raw = await this.#executor.execute(toolName, params);
        // Unwrap screenshot objects — don't store full base64 in memory
        if (raw && typeof raw === 'object' && raw.type === 'screenshot') {
          result = '[screenshot captured]';
        } else {
          result = typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? '');
        }
      } catch (err) {
        error = err.message;
        result = `ERROR: ${err.message}`;
        logger.warn({ step, tool: toolName, error: err.message }, 'Tool execution failed');
      }

      this.#memory.push({ step, tool: toolName, params, result, error });
    }
  }
}
