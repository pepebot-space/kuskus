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
2. After navigation, use 'snapshot' to understand the page structure
3. Use CSS selectors to interact with elements
4. If an action fails, try alternative selectors or approaches
5. Report your progress and final results clearly

Always think step by step and use snapshot/screenshot to verify your actions.`;

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

        // Debug: show LLM reasoning
        if (message.content) {
            logger.print(`\n💭 Agent: ${message.content}`);
            logger.plan('LLM response:', message.content);
        }

        messages.push(message);

        // Check if agent is done (no tool calls)
        if (choice.finish_reason === 'stop' || !message.tool_calls || message.tool_calls.length === 0) {
            logger.print('\n✅ Agent completed task');
            logger.step('Agent finished — no more tool calls');
            return {
                success: true,
                steps: step,
                finalResponse: message.content || '(no response)',
            };
        }

        // Execute tool calls
        for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function.name;
            const fnArgs = JSON.parse(toolCall.function.arguments);

            logger.print(`\n🔧 Tool: ${fnName}(${JSON.stringify(fnArgs)})`);
            logger.tool(`Executing: ${fnName}`, fnArgs);

            try {
                const result = await executeTool(fnName, fnArgs);

                // Format result for display (truncate big data)
                const displayResult = formatResult(fnName, result);
                logger.print(`   ✓ ${displayResult}`);
                logger.tool(`Result:`, result);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result),
                });
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
