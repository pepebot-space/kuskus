/**
 * OpenAI Agent Planner — multi-step browser automation with function calling.
 *
 * Uses OpenAI's function calling to plan and execute browser tasks step by step.
 * Full debug logging shows planning decisions, tool selections, and results.
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import { tools, executeTool, getToolNames } from '../cdp/tools.js';
import { logger } from '../utils/logger.js';
import { zodToJsonSchema } from '../utils/schema.js';

const SYSTEM_PROMPT = `You are a browser automation agent. You control a real Chrome browser through CDP tools.

Available tools let you: navigate pages, click elements, type text, take screenshots, read console logs, inspect accessibility trees, measure performance, and more.

Instructions:
1. Break complex tasks into clear steps
2. After navigation, review the returned structuredData, textPreview, formHints, dataTestIds, and strategyHints before acting
3. If structuredData already contains the needed answer, use it directly instead of manipulating the page further. For search results (bing_search, google_search, etc.), synthesize a concise summary before taking new actions
4. When multiple sources exist in structuredData, prefer entries that are more specific and relevant to the user's task (e.g. direct product/service pages over generic search snippets), unless the user specifies otherwise
5. Use formHints and dataTestIds to identify reliable selectors for evaluate/click/type actions
6. Inspect specific DOM sections with 'snapshot' (and its htmlSnippet) only when you need additional structure
7. Prefer 'evaluate' to read specific selectors or extract text instead of scrolling
8. Simulate natural browsing: click inputs before typing, include brief waits between actions, and avoid issuing direct query URLs unless the user requests them
9. If the user mentions a specific website, navigate directly to that site instead of using a search engine. Only use a search engine when no specific site is mentioned
10. When no specific site is mentioned, begin with Bing (https://www.bing.com) to gather options before visiting individual sites. If the search engine returns a captcha or unusual-traffic hint, immediately pivot to an alternate engine (try https://www.google.com first, then https://duckduckgo.com) and continue the search there
11. Only apply site-specific shortcuts when the user explicitly mentions that site or when strategyHints recommend it
12. Only scroll when information is genuinely not present yet; avoid repeated scroll/snapshot loops
13. If an action fails, try alternative selectors or approaches and avoid repeating the same failure twice
14. Report your progress and final results clearly

Always think step by step and use the available text to reason before acting.`;

/**
 * Run the OpenAI agent to complete a task.
 */
export async function runAgent(task) {
    if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required for the agent. Set it in your environment.');
    }

    const openai = new OpenAI({ apiKey: config.openaiApiKey });

    // Build function definitions from tool schemas
    const functions = Object.values(tools)
        .filter(t => t.name !== 'closeBrowser')  // Don't let agent close browser mid-task
        .map(t => ({
            name: t.name,
            description: t.description,
            parameters: zodToJsonSchema(t.schema),
        }));

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: task },
    ];

    logger.print('\n🚀 Starting agent...');
    logger.print(`📋 Task: ${task}`);
    logger.print(`🤖 Model: ${config.openaiModel}`);
    logger.print(`🔧 Tools: ${getToolNames().length} available`);
    logger.print('─'.repeat(60));

    let step = 0;
    const maxSteps = config.maxAgentSteps;
    let lastTextResponse = '';
    const lastToolCall = { signature: '', count: 0 };
    const collectedDataEntries = [];

    while (step < maxSteps) {
        step++;
        logger.print(`\n📌 Step ${step}/${maxSteps}`);
        logger.step(`Step ${step} — calling LLM`);

        // Call OpenAI
        const response = await openai.chat.completions.create({
            model: config.openaiModel,
            messages,
            tools: functions.map(f => ({ type: 'function', function: f })),
            tool_choice: 'auto',
        });

        const choice = response.choices[0];
        const message = choice.message;
        const messageText = extractMessageText(message.content);

        // Debug: show LLM reasoning
        if (messageText) {
            lastTextResponse = messageText.trim();
            logger.print(`\n💭 Agent: ${messageText}`);
            logger.plan('LLM response:', messageText);
        } else if (message.content !== undefined && message.content !== null) {
            logger.plan('LLM response:', safeStringify(message.content));
        }

        if ((!message.tool_calls || message.tool_calls.length === 0) && collectedDataEntries.length) {
            const summary = summarizeStructuredData(collectedDataEntries, 5);
            if (summary) {
                lastTextResponse = summary;
            }
        }

        messages.push(message);

        // Check if agent is done (no tool calls)
        if (choice.finish_reason === 'stop' || !message.tool_calls || message.tool_calls.length === 0) {
            logger.print('\n✅ Agent completed task');
            logger.step('Agent finished — no more tool calls');
            const finalSummary = collectedDataEntries.length
                ? summarizeStructuredData(collectedDataEntries, 5) || lastTextResponse
                : lastTextResponse;

            return {
                success: true,
                steps: step,
                finalResponse: (messageText && messageText.trim()) || finalSummary || '(no response)',
            };
        }

        // Execute tool calls
        for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function.name;
            const fnArgs = JSON.parse(toolCall.function.arguments);

            logger.print(`\n🔧 Tool: ${fnName}(${JSON.stringify(fnArgs)})`);
            logger.tool(`Executing: ${fnName}`, fnArgs);

            const signature = `${fnName}::${JSON.stringify(fnArgs)}`;
            if (signature === lastToolCall.signature) {
                lastToolCall.count += 1;
            } else {
                lastToolCall.signature = signature;
                lastToolCall.count = 1;
            }

            if (lastToolCall.count > 2) {
                const messageContent = {
                    error: `Repeated tool call prevented for ${fnName}. Try a different approach.`
                };
                logger.print(`   ✗ Repetition limit hit for ${signature}`);
                logger.error(`Tool ${fnName} repetition prevented`);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(messageContent),
                });
                continue;
            }

            try {
                const result = await executeTool(fnName, fnArgs);
                const sanitized = sanitizeToolResult(result);

                // Format result for display (truncate big data)
                const displayResult = formatResult(fnName, sanitized);
                logger.print(`   ✓ ${displayResult}`);
                logger.tool(`Result:`, sanitized);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(sanitized),
                });

                const entries = Array.isArray(sanitized?.structuredData)
                    ? sanitized.structuredData
                    : Array.isArray(sanitized)
                        ? sanitized
                        : [];
                if (entries.length) {
                    collectedDataEntries.push(...entries);
                }
            } catch (err) {
                logger.print(`   ✗ Error: ${err.message}`);
                logger.error(`Tool ${fnName} failed:`, err.message);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: err.message }),
                });
            }
        }
    }

    logger.print(`\n⚠️  Max steps (${maxSteps}) reached`);
    return {
        success: false,
        steps: step,
        finalResponse: 'Max steps reached without completion',
    };
}

/**
 * Format a tool result for human-readable display.
 */
function formatResult(toolName, result) {
    if (result.screenshot) return '(screenshot captured)';
    if (result.snapshot) return `Page: ${result.title} — ${result.snapshot.slice(0, 120)}...`;
    if (result.accessibilityTree) return `(accessibility tree with ${JSON.stringify(result.accessibilityTree).length} chars)`;
    if (result.logs) return `${result.count} console logs`;
    if (result.requests) return `${result.count} network requests`;
    if (result.metrics) return `${Object.keys(result.metrics).length} metrics`;

    const str = JSON.stringify(result);
    return str.length > 150 ? str.slice(0, 147) + '...' : str;
}

function sanitizeToolResult(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > 4) return '[truncated]';

    if (typeof value === 'string') {
        return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
    }

    if (Array.isArray(value)) {
        if (value.length > 50) {
            const trimmed = value.slice(0, 50).map(item => sanitizeToolResult(item, depth + 1));
            trimmed.push(`… (${value.length - 50} more items)`);
            return trimmed;
        }
        return value.map(item => sanitizeToolResult(item, depth + 1));
    }

    if (typeof value === 'object') {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            if (key === 'screenshot') {
                result[key] = '[base64 omitted]';
                continue;
            }
            result[key] = sanitizeToolResult(val, depth + 1);
        }
        return result;
    }

    return value;
}

/**
 * Extract plain text from OpenAI message content (string | array | object).
 */
function extractMessageText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part === 'object') {
                    if (typeof part.text === 'string') return part.text;
                    if (typeof part.content === 'string') return part.content;
                    if (part.type === 'text' && typeof part.text === 'string') return part.text;
                    if (part.type === 'input_text' && typeof part.input_text === 'string') return part.input_text;
                }
                return '';
            })
            .filter(Boolean)
            .join('\n\n');
    }
    if (typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (content.type === 'text' && typeof content.text === 'string') return content.text;
        if (content.type === 'input_text' && typeof content.input_text === 'string') return content.input_text;
    }
    return '';
}

function safeStringify(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function summarizeStructuredData(entries, maxItems = 5) {
    if (!Array.isArray(entries) || entries.length === 0) return '';

    const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
    const seen = new Set();

    const scoreEntry = (entry) => {
        const source = normalize(entry.source).toLowerCase();

        // Prioritize focused/direct results over generic search snippets
        if (source.includes('_focus')) return 0;
        if (source.includes('_search') || source.includes('_news')) return 2;
        if (!source) return 1;
        return 1;
    };

    const scored = entries
        .map((entry) => ({ entry, score: scoreEntry(entry) }))
        .sort((a, b) => a.score - b.score)
        .map(({ entry }) => entry)
        .filter((entry) => {
            const key = normalize(entry.url) || normalize(entry.name);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, maxItems);

    if (!scored.length) return '';

    const lines = scored.map((entry) => {
        const name = normalize(entry.name) || 'Result';
        const snippet = normalize(entry.snippet);
        const url = normalize(entry.url);
        const parts = [name];
        if (snippet) parts.push(`— ${snippet}`);
        if (url) parts.push(`(${url})`);
        return `- ${parts.join(' ')}`;
    });

    return lines.join('\n');
}
