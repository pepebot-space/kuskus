#!/usr/bin/env node
import 'dotenv/config';
import { ensureBrowser } from '../src/utils/browser.js';
import { startMCPServer } from '../src/mcp/server.js';

const cdpUrl = new URL(process.env.CDP_URL || 'ws://localhost:9222');
const port   = Number(cdpUrl.port) || 9222;
const host   = cdpUrl.hostname;

// MCP servers communicate over stdio — log setup messages to stderr only
const log = (msg) => process.stderr.write(`[kuskus] ${msg}\n`);

let browserProc = null;

async function main() {
  browserProc = await ensureBrowser({ port, host, install: true, log });
  await startMCPServer();
}

// Clean up browser on exit
function cleanup() {
  if (browserProc && !browserProc.killed) {
    browserProc.kill();
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

main().catch((err) => {
  process.stderr.write(`[kuskus] Fatal: ${err.message}\n`);
  process.exit(1);
});
