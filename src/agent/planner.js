import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TASK_CONTEXT_TEMPLATE } from './prompts.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { htmlToReadableText } from '../utils/dom-to-text.js';
import logger from '../utils/logger.js';

/**
 * Drives the agent planning loop using Claude tool use.
 */
export class Planner {
  #client;
  #model;
  #maxTokens;
  #includeScreenshot;

  constructor({
    apiKey,
    model = 'claude-sonnet-4-6',
    maxTokens = 4096,
    includeScreenshot = true,
  } = {}) {
    this.#client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
    this.#model = model;
    this.#maxTokens = maxTokens;
    this.#includeScreenshot = includeScreenshot;
  }

  /**
   * Ask Claude for the next tool call given the current browser state.
   *
   * @param {object} opts
   * @param {string} opts.task          - original user task
   * @param {number} opts.step          - current step number
   * @param {number} opts.maxSteps
   * @param {string} opts.history       - stringified action history
   * @param {string|null} opts.screenshot   - base64 PNG or null
   * @param {string} opts.pageContent   - readable page text
   * @param {string} opts.currentUrl
   * @returns {Promise<{ toolName: string, params: object }>}
   */
  async nextAction({ task, step, maxSteps, history, screenshot, pageContent, currentUrl }) {
    const userContent = [];

    if (this.#includeScreenshot && screenshot) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: screenshot },
      });
    }

    const contextText = [
      TASK_CONTEXT_TEMPLATE(task, step, maxSteps),
      `Current URL: ${currentUrl}`,
      '',
      '## Previous Actions',
      history,
      '',
      '## Current Page Content',
      pageContent.slice(0, 6000),
    ].join('\n');

    userContent.push({ type: 'text', text: contextText });

    logger.debug({ step, url: currentUrl }, 'Calling Claude for next action');

    const response = await this.#client.messages.create({
      model: this.#model,
      max_tokens: this.#maxTokens,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userContent }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      // Claude returned text only — treat as finish
      const textBlock = response.content.find((b) => b.type === 'text');
      return { toolName: 'finish', params: { result: textBlock?.text || 'Task complete.' } };
    }

    logger.debug({ tool: toolUse.name, params: toolUse.input }, 'Claude chose tool');
    return { toolName: toolUse.name, params: toolUse.input };
  }
}
