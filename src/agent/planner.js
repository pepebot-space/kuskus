import { createProvider, detectProvider } from './providers.js';
import { SYSTEM_PROMPT, TASK_CONTEXT_TEMPLATE, PLANNING_SYSTEM_PROMPT, PLANNING_USER_TEMPLATE } from './prompts.js';
import logger from '../utils/logger.js';

/**
 * Drives the agent planning loop.
 * Supports Anthropic (Claude) and OpenAI (GPT / o-series) via auto-detection.
 */
export class Planner {
  #provider;
  #model;
  #maxTokens;
  #includeScreenshot;

  constructor({
    provider = null,
    apiKey = null,
    model = process.env.AGENT_MODEL || 'claude-sonnet-4-6',
    maxTokens = 4096,
    includeScreenshot = true,
  } = {}) {
    this.#model = model;
    this.#maxTokens = maxTokens;
    this.#includeScreenshot = includeScreenshot;
    this.#provider = createProvider({
      provider: provider || process.env.AGENT_PROVIDER || null,
      model,
      apiKey,
      maxTokens,
      systemPrompt: SYSTEM_PROMPT,
    });

    logger.debug({ provider: this.#provider.provider, model }, 'Planner initialized');
  }

  get providerName() { return this.#provider.provider; }

  /**
   * Generate a structured execution plan from a user task before the agent loop starts.
   *
   * @param {string} task
   * @returns {Promise<string>} plain-text plan
   */
  async plan(task) {
    logger.debug({ provider: this.#provider.provider }, 'Generating task plan');
    try {
      return await this.#provider.textCall({
        systemPrompt: PLANNING_SYSTEM_PROMPT,
        userText: PLANNING_USER_TEMPLATE(task),
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Planning step failed, continuing without plan');
      return null;
    }
  }

  /**
   * Ask the LLM for the next tool call given the current browser state.
   *
   * @param {object} opts
   * @param {string}      opts.task
   * @param {number}      opts.step
   * @param {number}      opts.maxSteps
   * @param {string}      opts.history
   * @param {string|null} opts.screenshot   base64 PNG or null
   * @param {string}      opts.pageContent
   * @param {string}      opts.currentUrl
   * @param {string|null} opts.plan
   * @returns {Promise<{ toolName: string, params: object }>}
   */
  async nextAction({ task, step, maxSteps, history, screenshot, pageContent, currentUrl, plan }) {
    const userContent = [];

    if (this.#includeScreenshot && screenshot) {
      userContent.push(this.#provider.buildImageBlock(screenshot));
    }

    const contextText = [
      TASK_CONTEXT_TEMPLATE(task, step, maxSteps, plan),
      `Current URL: ${currentUrl}`,
      '',
      '## Previous Actions',
      history,
      '',
      '## Current Page Content',
      pageContent.slice(0, 6000),
    ].join('\n');

    userContent.push({ type: 'text', text: contextText });

    logger.debug({ step, url: currentUrl, provider: this.#provider.provider }, 'Calling LLM');

    return this.#provider.call({ userContent });
  }
}
