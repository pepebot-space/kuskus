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

Available tools let you: navigate pages, read page content, click elements, type text, take screenshots, read console logs, inspect accessibility trees, measure performance, and more.

## Task archetypes — pick ONE up front, then follow its tool order

A) READ / EXTRACT CONTENT  ("ambil isi", "baca", "ringkas", "what does this page say")
   → navigate(url) → readPage() → answer. STOP.
   Do NOT scroll. Do NOT snapshot. Do NOT re-navigate. The answer is in readPage's content field.
   readPage returns clean main-article text with nav/header/footer/ads stripped.
   Only add more steps if readPage.fullLength is suspiciously small (<100 chars) or content is empty.

B) SEARCH / FIND  ("cari X", "who is X", "find info about X")
   → navigate to search engine → read structuredData/bing_search entries → navigate to the most relevant result → readPage() → answer.
   If structuredData already has the answer, stop there.

C) INTERACT  ("login", "fill form", "click X", "buy Y")
   → navigate → inspect formHints/dataTestIds → click/type/selectOption → verify result.

D) INSPECT STRUCTURE  ("what selectors does this page have", "find the X button")
   → navigate → snapshot or getAccessibilityTree. This is the ONLY case where snapshot is the right tool.

## Tool-selection rules (strict)

- readPage is the default way to READ page content. Use it after navigate whenever the user wants information, text, article body, or a summary.
- snapshot is for INSPECTING DOM STRUCTURE to find selectors — not for reading content. Its output is noisy tag trees, not article text.
- scroll is ONLY for lazy-loaded / infinite-scroll pages where readPage returned too little content. Never scroll preemptively.
- evaluate is for extracting a specific field via a precise selector (price, count, etc.), not for reading prose.
- Do not repeat snapshot + scroll in a loop. If readPage output is insufficient, try readPage with a specific selector before scrolling.

## General conduct

1. Break complex tasks into clear steps, but prefer the shortest path that answers the user.
2. After navigate, review structuredData, textPreview, formHints, dataTestIds, strategyHints. strategyHints often tells you exactly what to do next — follow it.
3. If structuredData already contains the needed answer, use it directly. For search results, synthesize a concise summary before taking new actions.
4. When multiple sources exist in structuredData, prefer entries that are more specific and relevant to the user's task (direct product/service pages over generic search snippets), unless the user specifies otherwise.
5. Use formHints and dataTestIds to identify reliable selectors for click/type/evaluate.
6. Simulate natural browsing on interactive tasks: click inputs before typing, brief waits between actions, avoid issuing direct query URLs unless the user requests them.
7. If the user mentions a specific website, navigate directly. Only use a search engine when no specific site is mentioned.
8. When no specific site is mentioned, begin with Bing (https://www.bing.com). On captcha or unusual-traffic hints, pivot to https://www.google.com then https://duckduckgo.com.
9. Apply site-specific shortcuts only when the user explicitly mentions that site or when strategyHints recommend it.
10. If an action fails, try alternative selectors and avoid repeating the same failure twice.
11. Report your progress and final results clearly.

Always think step by step. Pick the archetype first, then follow its tool order.`;

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
    const recentToolNames = []; // track last N tool names for pattern detection
    let readPageHintInjected = false;

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

            // Track tool name history and detect snapshot/scroll loops without readPage.
            recentToolNames.push(fnName);
            if (recentToolNames.length > 6) recentToolNames.shift();
            if (!readPageHintInjected && recentToolNames.length >= 4) {
                const navOrReadCount = recentToolNames.filter(n => n === 'snapshot' || n === 'scroll').length;
                const hasReadPage = recentToolNames.includes('readPage');
                if (navOrReadCount >= 3 && !hasReadPage) {
                    readPageHintInjected = true;
                    logger.print(`   💡 Injecting readPage hint (snapshot/scroll loop detected)`);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            hint: 'You have been cycling snapshot/scroll. If the goal is to read page content, call readPage instead — it returns the full cleaned article text in one call. snapshot is only for finding selectors; scroll is only for lazy-loaded lists.',
                            suggestedTool: 'readPage',
                        }),
                    });
                    continue;
                }
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
