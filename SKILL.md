---
name: Kuskus CDP Tools
description: CDP-based browser automation tool with MCP server and CLI, powered by Puppeteer and OpenAI
---

# Kuskus — CDP Browser Automation

A complete Chrome DevTools Protocol (CDP) tool that provides browser automation through two interfaces: **MCP server** and **CLI**. Built on Puppeteer for direct CDP access. Uses OpenAI for multi-step autonomous agent tasks.

## Architecture

```
┌─────────────────────────────────────────────┐
│           MCP Client / CLI User             │
└────────────────────┬────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   kuskus CLI        │  bin/kuskus.js
          │   (commander)       │
          └─┬────────────────┬──┘
            │                │
  ┌─────────▼─────┐  ┌──────▼───────┐
  │  MCP Server   │  │ OpenAI Agent │  src/agent/planner.js
  │  (stdio)      │  │ (multi-step) │
  └─────────┬─────┘  └──────┬───────┘
            │                │
          ┌─▼────────────────▼──┐
          │    CDP Tools Layer  │  src/cdp/tools.js
          │    (20 tools)       │
          └─────────┬───────────┘
                    │
          ┌─────────▼───────────┐
          │  Puppeteer/CDP      │  src/cdp/browser.js
          │  (headless Chrome)  │
          └─────────────────────┘
```

## Quick Start

```bash
npm install

# List tools
node bin/kuskus.js list

# Run a single tool
node bin/kuskus.js call navigate '{"url":"https://example.com"}'

# Multi-step agent (requires OPENAI_API_KEY)
node bin/kuskus.js run "go to example.com and get the title"

# Start MCP server (for Claude Desktop, Cursor, etc.)
node bin/kuskus.js mcp
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `kuskus mcp` | Start MCP server over stdio |
| `kuskus list` | List all available CDP tools |
| `kuskus call <tool> [json]` | Execute a single tool |
| `kuskus run "<task>"` | Run OpenAI multi-step agent |

### Flags
- `--debug` — Enable verbose logging with categories [PLAN], [TOOL], [STEP], [CDP], [MCP]
- `--headless <bool>` — Run browser headless (default: true)
- `--model <model>` — OpenAI model (default: gpt-4o-mini)
- `--cdp-port <port>` — CDP port (default: 9222)
- `--chrome-path <path>` — Path to Chrome/Chromium binary

## Tool Catalog (20 tools)

### Navigation
| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `goBack` | Go back in history |
| `goForward` | Go forward in history |
| `reload` | Reload current page |

### Interaction
| Tool | Description |
|------|-------------|
| `click` | Click element by CSS selector |
| `type` | Type text into element |
| `hover` | Hover over element |
| `selectOption` | Select from dropdown |
| `pressKey` | Press keyboard key |
| `scroll` | Scroll page or element |

### Inspection
| Tool | Description |
|------|-------------|
| `snapshot` | Get page URL, title, DOM snapshot |
| `screenshot` | Capture PNG screenshot |
| `getConsoleLogs` | Get console log entries |
| `evaluate` | Execute JavaScript |

### Network
| Tool | Description |
|------|-------------|
| `enableNetworkCapture` | Enable/disable network logging |
| `getNetworkRequests` | Get captured network requests |

### Performance
| Tool | Description |
|------|-------------|
| `getPerformanceMetrics` | Get Chrome perf metrics |
| `startTrace` | Start performance trace |
| `stopTrace` | Stop trace and get data |

### Accessibility
| Tool | Description |
|------|-------------|
| `getAccessibilityTree` | Get page accessibility tree |

### Lifecycle
| Tool | Description |
|------|-------------|
| `wait` | Wait for duration |
| `closeBrowser` | Close browser |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required for `run` command |
| `KUSKUS_MODEL` | `gpt-4o-mini` | OpenAI model |
| `KUSKUS_HEADLESS` | `true` | Headless browser mode |
| `KUSKUS_CDP_PORT` | `9222` | CDP remote debugging port |
| `KUSKUS_DEBUG` | `false` | Enable debug logging |
| `KUSKUS_NAV_TIMEOUT` | `30000` | Navigation timeout (ms) |
| `KUSKUS_TOOL_TIMEOUT` | `15000` | Tool timeout (ms) |
| `KUSKUS_MAX_STEPS` | `25` | Max agent steps |
| `KUSKUS_VIEWPORT_WIDTH` | `1280` | Browser viewport width |
| `KUSKUS_VIEWPORT_HEIGHT` | `720` | Browser viewport height |
| `KUSKUS_CHROME_PATH` | — | Custom Chrome binary path |

## Chrome Resolution

Chrome is resolved automatically in this order:
1. `KUSKUS_CHROME_PATH` env var (explicit override)
2. System Chrome/Chromium (OS-specific paths)
3. Previously installed Chrome in `~/.local/chrome/`
4. Auto-download **Chrome for Testing** from Google's CDN

Supported platforms: macOS (arm64/x64), Linux (x64), Windows (x86/x64).

Installed builds are cached in `~/.local/chrome/<version>/` with a `meta.json` marker for reuse.

## MCP Server Config

For Claude Desktop or Cursor, add to your MCP config:

```json
{
  "mcpServers": {
    "kuskus": {
      "command": "node",
      "args": ["/path/to/kuskus/bin/kuskus.js", "mcp"]
    }
  }
}
```

## Debug Logging

Enable with `--debug` or `KUSKUS_DEBUG=true`. Shows categorized output:
- `[PLAN]` — LLM planning steps (magenta)
- `[TOOL]` — Tool executions (cyan)
- `[STEP]` — Multi-step progress (yellow)
- `[CDP]` — Raw CDP events (gray)
- `[MCP]` — MCP server events (blue)
