import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { TOOL_DEFINITIONS } from './tools.js';

/**
 * Detect provider from model name.
 * @param {string} model
 * @returns {'anthropic' | 'openai'}
 */
export function detectProvider(model = '') {
  const m = model.toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') ||
      m.startsWith('o4') || m.startsWith('chatgpt')) return 'openai';
  return 'anthropic'; // claude-* and default
}

// ── Tool format conversion ────────────────────────────────────────────────────

/** Anthropic tools are already in the right format */
const anthropicTools = TOOL_DEFINITIONS;

/** Convert to OpenAI function-calling format */
const openaiTools = TOOL_DEFINITIONS.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ── Provider implementations ──────────────────────────────────────────────────

function buildAnthropicProvider({ apiKey, model, maxTokens, systemPrompt }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  return {
    async call({ userContent }) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: anthropicTools,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userContent }],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse) {
        const text = response.content.find((b) => b.type === 'text')?.text || 'Task complete.';
        return { toolName: 'finish', params: { result: text } };
      }
      return { toolName: toolUse.name, params: toolUse.input };
    },

    async textCall({ systemPrompt: sys, userText }) {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: sys,
        messages: [{ role: 'user', content: userText }],
      });
      return response.content.find((b) => b.type === 'text')?.text?.trim() || '';
    },

    buildImageBlock(base64) {
      return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } };
    },
  };
}

function buildOpenAIProvider({ apiKey, model, maxTokens, systemPrompt }) {
  const client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });

  return {
    async call({ userContent }) {
      // Convert Anthropic-style content array to OpenAI content array
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        tools: openaiTools,
        tool_choice: 'required',
        messages,
      });

      const msg = response.choices[0].message;
      const toolCall = msg.tool_calls?.[0];
      if (!toolCall) {
        return { toolName: 'finish', params: { result: msg.content || 'Task complete.' } };
      }

      let params;
      try { params = JSON.parse(toolCall.function.arguments); }
      catch { params = {}; }

      return { toolName: toolCall.function.name, params };
    },

    async textCall({ systemPrompt: sys, userText }) {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userText },
        ],
      });
      return response.choices[0].message.content?.trim() || '';
    },

    buildImageBlock(base64) {
      return {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}`, detail: 'auto' },
      };
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a provider-agnostic LLM interface.
 *
 * @param {object} opts
 * @param {'anthropic'|'openai'|null} opts.provider   explicit provider, or null to auto-detect
 * @param {string}  opts.model
 * @param {string}  [opts.apiKey]
 * @param {number}  opts.maxTokens
 * @param {string}  opts.systemPrompt
 * @returns {{ call(args): Promise<{toolName,params}>, buildImageBlock(b64): object, provider: string }}
 */
export function createProvider({ provider, model, apiKey, maxTokens, systemPrompt }) {
  const resolved = provider || detectProvider(model);

  const impl = resolved === 'openai'
    ? buildOpenAIProvider({ apiKey, model, maxTokens, systemPrompt })
    : buildAnthropicProvider({ apiKey, model, maxTokens, systemPrompt });

  return { ...impl, provider: resolved };
}
