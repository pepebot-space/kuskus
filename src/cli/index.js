/**
 * CLI — kuskus command-line interface for CDP tools.
 *
 * Usage:
 *   kuskus mcp              Start MCP server (stdio)
 *   kuskus list              List available tools
 *   kuskus call <tool> [json]  Execute a single tool
 *   kuskus run "<task>"      Run multi-step agent (requires OPENAI_API_KEY)
 */

import { Command } from 'commander';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { tools, executeTool, getToolNames, getToolDefinitions } from '../cdp/tools.js';
import { startMCPServer } from '../mcp/server.js';
import { runAgent } from '../agent/planner.js';
import { closeBrowser } from '../cdp/browser.js';
import { runDoctor } from './doctor.js';

const program = new Command();

program
    .name('kuskus')
    .description('CDP-based browser automation — MCP server + CLI')
    .version('1.0.0')
    .option('--debug', 'Enable debug logging', false)
    .option('--headless <bool>', 'Run browser headless (default: true)')
    .option('--model <model>', 'OpenAI model for agent (default: gpt-4o-mini)')
    .option('--cdp-port <port>', 'Chrome DevTools Protocol port')
    .option('--chrome-path <path>', 'Path to Chrome/Chromium binary')
    .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.debug) process.env.KUSKUS_DEBUG = 'true';
        if (opts.headless !== undefined) process.env.KUSKUS_HEADLESS = opts.headless;
        if (opts.model) process.env.KUSKUS_MODEL = opts.model;
        if (opts.cdpPort) process.env.KUSKUS_CDP_PORT = opts.cdpPort;
        if (opts.chromePath) process.env.KUSKUS_CHROME_PATH = opts.chromePath;
    });

// ─── doctor ──────────────────────────────────────────────────────────────────

program
    .command('doctor')
    .description('Check environment, Chrome, and dependencies')
    .action(async () => {
        await runDoctor();
    });

// ─── mcp ─────────────────────────────────────────────────────────────────────

program
    .command('mcp')
    .description('Start the MCP server over stdio')
    .action(async () => {
        await startMCPServer();
    });

// ─── list ────────────────────────────────────────────────────────────────────

program
    .command('list')
    .description('List all available CDP tools')
    .action(async () => {
        console.log('\n🔧 Available CDP Tools\n');
        console.log('─'.repeat(60));

        const defs = getToolDefinitions();
        for (const def of defs) {
            const params = def.inputSchema?.shape
                ? Object.keys(def.inputSchema.shape).join(', ')
                : '';
            console.log(`  ${def.name}`);
            console.log(`    ${def.description}`);
            if (params) console.log(`    params: ${params}`);
            console.log();
        }

        console.log(`Total: ${defs.length} tools`);
    });

// ─── call ────────────────────────────────────────────────────────────────────

program
    .command('call <tool> [params]')
    .description('Execute a single CDP tool with JSON parameters')
    .action(async (toolName, paramsJson) => {
        try {
            const params = paramsJson ? JSON.parse(paramsJson) : {};
            logger.print(`\n🔧 Calling: ${toolName}(${JSON.stringify(params)})\n`);

            const result = await executeTool(toolName, params);

            // Handle screenshot — save to file
            if (result.screenshot) {
                const fs = await import('fs');
                const filename = `screenshot_${Date.now()}.png`;
                fs.writeFileSync(filename, Buffer.from(result.screenshot, 'base64'));
                console.log(`📸 Screenshot saved: ${filename}`);
            } else {
                console.log(JSON.stringify(result, null, 2));
            }
        } catch (err) {
            logger.error(err.message);
            process.exit(1);
        } finally {
            await closeBrowser();
        }
    });

// ─── run ─────────────────────────────────────────────────────────────────────

program
    .command('run <task>')
    .description('Run multi-step browser agent (requires OPENAI_API_KEY)')
    .action(async (task) => {
        try {
            const result = await runAgent(task);

            console.log('\n' + '═'.repeat(60));
            console.log('📊 Agent Result');
            console.log('═'.repeat(60));
            console.log(`Status: ${result.success ? '✅ Success' : '⚠️  Incomplete'}`);
            console.log(`Steps: ${result.steps}`);
            console.log(`Response: ${result.finalResponse}`);
        } catch (err) {
            logger.error(err.message);
            process.exit(1);
        } finally {
            await closeBrowser();
        }
    });

// ─── Default action (no subcommand) → start MCP ─────────────────────────────

program.action(async () => {
    await startMCPServer();
});

// Run
program.parseAsync(process.argv).catch((err) => {
    logger.error(err.message);
    process.exit(1);
});
