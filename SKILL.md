# Kuskus Skill Overview

Kuskus is a CLI and MCP server that lets an AI agent control a real Chrome/Chromium browser over the Chrome DevTools Protocol. Use it when you need rich browser interactions (navigation, DOM scraping, screenshots) in automated workflows.

## Capabilities
- Launches or attaches to a local Chrome/Chromium instance (headless or visible).
- Auto-detects Anthropic or OpenAI models based on name; supports GPT-4o and Claude Sonnet out of the box.
- Exposes a full tool palette (navigation, DOM queries, input, waits, screenshots) via JSON-schema definitions.
- Provides a REPL for interactive runs and a script runner for batch tasks.
- MCP server mode surfaces the same browser tools to host applications (Claude Desktop, Cursor, etc.).
- Includes helpers for search tasks (e.g., `extract_serp_results` to capture Google result titles/snippets quickly).

## Quick Start (CLI)
```bash
export OPENAI_API_KEY=sk-...

# one-shot task (visible browser)
npx @porcupine/kuskus run "Visit https://example.com and report the heading" --model gpt-4o --launch

# interactive REPL with Claude
export ANTHROPIC_API_KEY=sk-ant-...
npx @porcupine/kuskus repl --model claude-sonnet-4-6 --launch
```

Key flags:
- `--launch` / `--no-headless` – start Chrome automatically, optionally with a window.
- `--force-launch` – shut down any existing debugging browser before launching.
- `--user-data-dir` – point to a Chrome profile so sessions persist across runs.
- `--output json` – return structured data when tools emit payloads.

## MCP Integration
Start the MCP server and let the host model drive planning:

```bash
npx @porcupine/kuskus mcp --launch --no-headless
```

Configure your MCP-compatible client to use the `kuskus` command. Available tools include page navigation, content extraction, screenshot capture, and tab management.

## Deployment Notes
- Chrome auto-detection checks standard install paths and environment overrides (`CDP_BROWSER_PATH`, `CHROME_PATH`, `GOOGLE_CHROME_BIN`).
- When no browser is found, the CLI downloads the latest Chromium-for-Testing build into `~/.local/chrome/<version>`.
- Ensure `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set before running tasks that use those providers.

## Troubleshooting
- Use `--debug` to stream CDP traffic and planner logs.
- If a previous headless session is blocking `--no-headless`, add `--force-launch` to close it before relaunch.
- Screenshots can be saved automatically with `--screenshots <dir>`.
- The agent can invoke `wait_for_navigation` to wait for redirects (e.g., after SSO login) without manual prompts.
