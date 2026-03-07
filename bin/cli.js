#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { KuskusAgent } from '../src/agent/index.js';
import { SessionManager } from '../src/cdp/session.js';
import { createPageDomain } from '../src/cdp/domains/page.js';
import { saveScreenshot, screenshotFilename } from '../src/utils/screenshot.js';
import { ensureBrowser } from '../src/utils/browser.js';
import { ensureChromium } from '../src/utils/chromium.js';

const VERSION = '0.1.1';

program
  .name('kuskus')
  .description('AI browser agent using CDP + Chromium/Chrome')
  .version(VERSION);

// ── run command ──────────────────────────────────────────────────────────────
program
  .command('run <task>')
  .description('Run a one-shot natural language task')
  .option('--cdp-url <url>', 'CDP WebSocket URL', process.env.CDP_URL || 'ws://localhost:9222')
  .option('--provider <name>', 'LLM provider: anthropic or openai (auto-detected from model name if not set)')
  .option('--model <model>', 'Model name (default: claude-sonnet-4-6)', process.env.AGENT_MODEL || 'claude-sonnet-4-6')
  .option('--max-steps <n>', 'Max agent steps', String(process.env.AGENT_MAX_STEPS || 20))
  .option('--screenshots <dir>', 'Directory to save step screenshots')
  .option('--no-screenshot', 'Disable screenshot capture in agent loop')
  .option('--launch', 'Auto-launch Chrome/Chromium before running')
  .option('--launch-path <path>', 'Path to Chrome/Chromium binary')
  .option('--no-headless', 'Launch Chrome/Chromium with a visible window')
  .option('--force-launch', 'Shut down an existing debugging browser before launching')
  .option('--debug', 'Enable debug logging')
  .option('--output <format>', 'Output format: text or json', 'text')
  .action(async (task, opts) => {
    if (opts.debug) process.env.LOG_LEVEL = 'debug';

    let browser;
    if (opts.launch) {
      const port = Number(new URL(opts.cdpUrl).port) || 9222;
      const forceLaunch = opts.forceLaunch || opts.headless === false;
      browser = await ensureBrowser({
        port,
        log: (m) => console.log(chalk.gray(m)),
        binaryPath: opts.launchPath,
        headless: opts.headless,
        force: forceLaunch,
      });
    }

    const spinner = ora(chalk.cyan(`Running task: ${task}`)).start();
    let currentStep = 0;

    const agent = new KuskusAgent({
      cdpUrl: opts.cdpUrl,
      provider: opts.provider || null,
      model: opts.model,
      maxSteps: Number(opts.maxSteps),
      screenshotDir: opts.screenshots,
      includeScreenshot: opts.screenshot !== false,
      onStep({ step, tool, params, url }) {
        currentStep = step;
        spinner.text = chalk.cyan(`[${step}/${opts.maxSteps}] ${tool}`) + chalk.gray(` — ${url}`);
      },
    });

    try {
      await agent.connect();
      const result = await agent.run(task);

      spinner.succeed(chalk.green('Task complete'));

      if (opts.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('\n' + chalk.bold('Result:'));
        console.log(result.result);
        if (result.data !== undefined) {
          console.log('\n' + chalk.bold('Data:'));
          console.log(typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : result.data);
        }
        console.log(chalk.gray(`\nCompleted in ${result.steps} step(s).`));
      }
    } catch (err) {
      spinner.fail(chalk.red('Task failed: ' + err.message));
      if (opts.debug) console.error(err);
      process.exit(1);
    } finally {
      await agent.close();
      browser?.kill();
    }
  });

// ── repl command ─────────────────────────────────────────────────────────────
program
  .command('repl')
  .description('Start an interactive REPL session')
  .option('--cdp-url <url>', 'CDP WebSocket URL', process.env.CDP_URL || 'ws://localhost:9222')
  .option('--provider <name>', 'LLM provider: anthropic or openai (auto-detected if not set)')
  .option('--model <model>', 'Model name', process.env.AGENT_MODEL || 'claude-sonnet-4-6')
  .option('--max-steps <n>', 'Max steps per task', String(process.env.AGENT_MAX_STEPS || 20))
  .option('--screenshots <dir>', 'Directory to save screenshots')
  .option('--launch', 'Auto-launch Chrome/Chromium')
  .option('--launch-path <path>', 'Path to Chrome/Chromium binary')
  .option('--no-headless', 'Launch Chrome/Chromium with a visible window')
  .option('--force-launch', 'Shut down an existing debugging browser before launching')
  .action(async (opts) => {
    let browser;
    if (opts.launch) {
      const port = Number(new URL(opts.cdpUrl).port) || 9222;
      const forceLaunch = opts.forceLaunch || opts.headless === false;
      browser = await ensureBrowser({
        port,
        log: (m) => console.log(chalk.gray(m)),
        binaryPath: opts.launchPath,
        headless: opts.headless,
        force: forceLaunch,
      });
    }

    console.log(chalk.bold.cyan('\nKuskus Browser Agent REPL'));
    console.log(chalk.gray('Commands: !screenshot, !tabs, !history, !clear, !exit'));
    console.log(chalk.gray('Or type a task and press Enter.\n'));

    const agent = new KuskusAgent({
      cdpUrl: opts.cdpUrl,
      provider: opts.provider || null,
      model: opts.model,
      maxSteps: Number(opts.maxSteps),
      screenshotDir: opts.screenshots,
      onStep({ step, tool, params, url }) {
        console.log(chalk.gray(`  [${step}] ${tool} — ${url}`));
      },
    });

    try {
      await agent.connect();
    } catch (err) {
      console.error(chalk.red('Failed to connect: ' + err.message));
      browser?.kill();
      process.exit(1);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('kuskus> '),
      historySize: 100,
    });

    let history = [];

    rl.prompt();
    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }

      // Special commands
      if (input === '!exit') {
        rl.close();
        return;
      }
      if (input === '!clear') {
        history = [];
        console.log(chalk.gray('Memory cleared.'));
        rl.prompt();
        return;
      }
      if (input === '!history') {
        console.log(history.length ? history.map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No history.');
        rl.prompt();
        return;
      }
      if (input === '!tabs') {
        const session = new SessionManager({ host: 'localhost', port: Number(new URL(opts.cdpUrl).port) || 9222 });
        await session.connect();
        const tabs = (await session.listTargets()).filter((t) => t.type === 'page');
        console.log(tabs.map((t) => `  ${t.id.slice(0, 8)}  ${t.url}`).join('\n') || 'No tabs.');
        await session.close();
        rl.prompt();
        return;
      }
      if (input === '!screenshot') {
        try {
          const dir = opts.screenshots || './screenshots';
          const session = new SessionManager({ host: 'localhost', port: Number(new URL(opts.cdpUrl).port) || 9222 });
          await session.connect();
          const client = await session.getActiveSession();
          const page = createPageDomain(client);
          const data = await page.screenshot();
          const filename = screenshotFilename(0);
          const saved = await saveScreenshot(data, dir, filename);
          console.log(chalk.green(`Screenshot saved: ${saved}`));
          await session.close();
        } catch (err) {
          console.error(chalk.red('Screenshot failed: ' + err.message));
        }
        rl.prompt();
        return;
      }

      // Run task
      rl.pause();
      const spinner = ora(chalk.cyan(`Running: ${input}`)).start();
      try {
        const result = await agent.run(input);
        spinner.succeed(chalk.green('Done'));
        console.log('\n' + result.result + '\n');
        history.push(input);
      } catch (err) {
        spinner.fail(chalk.red(err.message));
      }
      rl.resume();
      rl.prompt();
    });

    rl.on('close', async () => {
      console.log(chalk.gray('\nGoodbye.'));
      await agent.close();
      browser?.kill();
      process.exit(0);
    });
  });

// ── script command ────────────────────────────────────────────────────────────
program
  .command('script <file>')
  .description('Run tasks from a JSON script file')
  .option('--cdp-url <url>', 'CDP WebSocket URL', process.env.CDP_URL || 'ws://localhost:9222')
  .option('--provider <name>', 'LLM provider: anthropic or openai (auto-detected if not set)')
  .option('--model <model>', 'Model name', process.env.AGENT_MODEL || 'claude-sonnet-4-6')
  .option('--max-steps <n>', 'Max steps per task', String(process.env.AGENT_MAX_STEPS || 20))
  .option('--screenshots <dir>', 'Directory to save screenshots')
  .option('--output <format>', 'Output format: text or json', 'text')
  .action(async (file, opts) => {
    const { readFileSync } = await import('fs');
    let tasks;
    try {
      tasks = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(tasks)) tasks = [tasks];
    } catch (err) {
      console.error(chalk.red('Failed to read script: ' + err.message));
      process.exit(1);
    }

    const agent = new KuskusAgent({
      cdpUrl: opts.cdpUrl,
      provider: opts.provider || null,
      model: opts.model,
      maxSteps: Number(opts.maxSteps),
      screenshotDir: opts.screenshots,
      onStep({ step, tool, url }) {
        console.log(chalk.gray(`  [${step}] ${tool} — ${url}`));
      },
    });

    const results = [];
    try {
      await agent.connect();
      for (let i = 0; i < tasks.length; i++) {
        const task = typeof tasks[i] === 'string' ? tasks[i] : tasks[i].task;
        console.log(chalk.bold(`\nTask ${i + 1}/${tasks.length}: ${task}`));
        const spinner = ora().start();
        try {
          const result = await agent.run(task);
          spinner.succeed(chalk.green(result.result.slice(0, 80)));
          results.push({ task, ...result, ok: true });
        } catch (err) {
          spinner.fail(chalk.red(err.message));
          results.push({ task, result: err.message, ok: false });
        }
      }
    } finally {
      await agent.close();
    }

    if (opts.output === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(chalk.bold('\nSummary:'));
      results.forEach((r, i) => {
        const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`${icon} Task ${i + 1}: ${r.result.slice(0, 100)}`);
      });
    }
  });

// ── mcp command ───────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Start the Kuskus MCP server (auto-downloads and launches Chromium)')
  .option('--cdp-url <url>', 'CDP WebSocket URL', process.env.CDP_URL || 'ws://localhost:9222')
  .option('--no-install', 'Skip auto-download of Chromium')
  .option('--no-launch', 'Skip auto-launch of Chromium (assume already running)')
  .action(async (opts) => {
    const port = Number(new URL(opts.cdpUrl).port) || 9222;
    const host = new URL(opts.cdpUrl).hostname;

    // All setup messages go to stderr so they don't corrupt MCP stdio
    const log = (msg) => process.stderr.write(`[kuskus] ${msg}\n`);

    let browserProc = null;
    if (opts.launch) {
      browserProc = await ensureBrowser({ port, host, install: opts.install, log });
    }

    const { startMCPServer } = await import('../src/mcp/server.js');
    await startMCPServer();

    const cleanup = () => { if (browserProc && !browserProc.killed) browserProc.kill(); };
    process.on('exit', cleanup);
    process.on('SIGINT',  () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  });

// ── install command ───────────────────────────────────────────────────────────
program
  .command('install')
  .description('Download and install Chromium to ~/.local')
  .option('--force', 'Re-download even if already installed')
  .action(async (opts) => {
    const spinner = ora('Installing Chromium...').start();
    try {
      const p = await ensureChromium({
        force: opts.force,
        log: (msg) => { spinner.text = msg; },
      });
      spinner.succeed(chalk.green(`Chromium installed: ${p}`));
    } catch (err) {
      spinner.fail(chalk.red(`Install failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
