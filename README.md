<p align="center">
  <img src="assets/logo.png" width="160" alt="Kuskus" />
</p>

<h1 align="center">Kuskus</h1>

<p align="center">
  AI browser agent via Chrome DevTools Protocol — CLI + MCP Server
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@porcupine/kuskus"><img src="https://img.shields.io/npm/v/@porcupine/kuskus?color=a78bfa&label=npm" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="node" />
  <img src="https://img.shields.io/badge/browser-Chromium-blue" alt="Chromium" />
  <img src="https://img.shields.io/badge/protocol-CDP-blue" alt="CDP" />
</p>

---

Kuskus controls a browser directly over the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) by auto-detecting an installed Chrome/Chromium build (or downloading one on demand).

Ships as two artifacts:

| | CLI | MCP Server |
|---|---|---|
| **Usage** | `kuskus run "task..."` | Claude Desktop, Cursor, OpenCode, etc. |
| **LLM** | Claude (via `ANTHROPIC_API_KEY`) | Host model — no key needed |
| **Role** | Full agent loop | Expose browser tools to any AI |

---

## Requirements

- Node.js >= 20
- Chrome or Chromium (auto-detected; falls back to downloading a Chromium build into `~/.local`)

---

## CLI

### Install

```bash
npm install -g @porcupine/kuskus
```

Or use directly with npx (no install needed):

```bash
npx @porcupine/kuskus run "your task here"
```

### Setup

```bash
cp .env.example .env
```

Set the API key for your chosen provider:

```env
# Anthropic (Claude) — default
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...
```

Provider is **auto-detected from the model name** — no need to set it explicitly:

| Model prefix | Provider |
|---|---|
| `claude-*` | Anthropic |
| `gpt-*`, `o1*`, `o3*`, `o4*`, `chatgpt-*` | OpenAI |

### Commands

#### `run` — one-shot task

```bash
kuskus run "go to news.ycombinator.com and summarize the top 5 posts"
```

Options:

```
--cdp-url <url>      CDP WebSocket URL (default: ws://localhost:9222)
--provider <name>    LLM provider: anthropic or openai (auto-detected if not set)
--model <model>      Model name (default: claude-sonnet-4-6)
--max-steps <n>      Max agent steps (default: 20)
--screenshots <dir>  Save step screenshots to directory
--launch             Auto-launch Chrome/Chromium before running
--no-headless        Launch Chrome/Chromium with a visible window
--force-launch       Shut down an existing debugging browser before launching
--output <format>    Output format: text or json (default: text)
--debug              Log raw CDP messages
```

#### `repl` — interactive session

```bash
kuskus repl --launch
```

Special commands inside REPL:

```
!screenshot   Capture and save the current viewport
!tabs         List open browser tabs
!history      Show action history
!clear        Reset agent memory
!exit         Quit
```

#### `script` — batch tasks from JSON

```bash
kuskus script ./tasks.json --output json
```

`tasks.json` format:

```json
[
  "go to github.com/lightpanda-io/browser and read the description",
  "search google for nodejs best practices 2025 and list the top 3 links"
]
```

#### `install` — manually install Chromium

```bash
kuskus install
# or force re-download
kuskus install --force
```

#### `mcp` — start MCP server

```bash
kuskus mcp
```

> Chromium is downloaded and launched automatically. No API key required.

---

## MCP Server

The MCP server exposes browser control tools to any AI host — Claude Desktop, Cursor, OpenCode, or any MCP-compatible client. The host model drives the reasoning; Kuskus only executes browser actions.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kuskus": {
      "command": "npx",
      "args": ["-y", "@porcupine/kuskus", "mcp"],
      "env": {
        "CDP_URL": "ws://localhost:9222"
      }
    }
  }
}
```

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "kuskus": {
      "type": "local",
      "command": ["npx", "-y", "@porcupine/kuskus", "mcp"],
      "enabled": true,
      "environment": {
        "CDP_URL": "ws://localhost:9222"
      }
    }
  }
}
```

### Cursor / other MCP clients

```json
{
  "mcpServers": {
    "kuskus": {
      "command": "npx",
      "args": ["-y", "@porcupine/kuskus", "mcp"]
    }
  }
}
```

### Available MCP Tools

#### Navigation
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |
| `browser_get_url` | Get current URL |

#### Observation
| Tool | Description |
|------|-------------|
| `browser_screenshot` | Capture viewport as PNG |
| `browser_get_content` | Get page text content |
| `browser_element_info` | Get element attributes and text |

#### Interaction
| Tool | Description |
|------|-------------|
| `browser_click` | Click element by CSS selector |
| `browser_type` | Type text into an input |
| `browser_key_press` | Press a key (Enter, Tab, Escape…) |
| `browser_scroll` | Scroll up or down |
| `browser_hover` | Hover over an element |
| `browser_select` | Select a `<select>` option |
| `browser_checkbox` | Check or uncheck a checkbox |

#### JavaScript
| Tool | Description |
|------|-------------|
| `browser_evaluate` | Execute JS and return result |
| `browser_extract` | Extract structured data via JS |

#### Tabs
| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List all open tabs |
| `browser_new_tab` | Open a new tab |
| `browser_switch_tab` | Switch to a tab by ID |
| `browser_close_tab` | Close a tab |

#### Utility
| Tool | Description |
|------|-------------|
| `browser_wait` | Wait N milliseconds (max 10s) |

### MCP Resources

| URI | Description |
|-----|-------------|
| `browser://screenshot` | Current viewport as PNG |
| `browser://page/content` | Current page text |
| `browser://page/url` | Current URL |
| `browser://tabs` | Open tabs as JSON |

---

## Architecture

```
Entry Points
  kuskus run / repl / script          kuskus mcp
          │                                │
          ▼                                ▼
    Agent Core                       MCP Server
  (plan → execute loop)          (expose tools directly)
  Claude API + tool use           no LLM — host model drives
          │                                │
          └──────────────┬─────────────────┘
                         ▼
                  Executor (CDP tools)
                         │
                  SessionManager
                  (single WebSocket,
                   session multiplexing)
                         │
              Chromium Browser
              ws://localhost:9222
```

### How the agent loop works

```
┌─────────────────────────────────────────────┐
│  1. Observe   get_page_content + screenshot  │
│  2. Plan      Claude picks next tool         │
│  3. Execute   CDP command via Chromium       │
│  4. Remember  append step to rolling history │
│  5. Repeat    until finish or max steps      │
└─────────────────────────────────────────────┘
```

---

## Configuration

All options via environment variables (`.env` file supported):

```env
# CLI only — not needed for MCP
ANTHROPIC_API_KEY=sk-ant-...      # for Claude models
OPENAI_API_KEY=sk-...             # for GPT / o-series models

# Provider: anthropic | openai — auto-detected from model name if not set
# AGENT_PROVIDER=anthropic

AGENT_MODEL=claude-sonnet-4-6    # or gpt-4o, o3-mini, etc.
AGENT_MAX_STEPS=20
AGENT_MAX_TOKENS=4096
AGENT_INCLUDE_SCREENSHOT=true
AGENT_SCREENSHOT_QUALITY=80

# Browser (CLI + MCP)
CDP_URL=ws://localhost:9222
# CDP_BROWSER_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
CDP_BROWSER_PORT=9222

# Logging
LOG_LEVEL=info                     # debug | info | warn | error
LOG_FORMAT=pretty                  # pretty | logfmt
```

---

## Browser Runtime

Kuskus looks for Chrome/Chromium automatically. It checks common install locations (`/Applications/Google Chrome.app`, `chromium`, etc.) and honours `CDP_BROWSER_PATH`, `CHROME_PATH`, and `GOOGLE_CHROME_BIN` if set.

When no suitable binary is found (and auto-install is allowed) Kuskus downloads the latest **Chromium for Testing** build to `~/.local/chrome/<version>` and symlinks it to `~/.local/bin/chromium`.

Supported platforms for auto-download:

| OS | Arch |
|----|------|
| Linux | x86_64, arm64 |
| macOS | x86_64 (Intel), arm64 (Apple Silicon) |

Use `CDP_BROWSER_PATH` to point at a custom binary if you prefer a specific channel (e.g. Chrome Canary) or an alternative CDP-compatible browser.

---

## Examples

```bash
# With Claude (default)
kuskus run "go to https://github.com/lightpanda-io/browser and summarize the README" --launch

# With GPT-4o — provider auto-detected from model name
kuskus run "go to news.ycombinator.com and list the top 5 posts" --model gpt-4o --launch

# With o3-mini
kuskus run "go to https://httpbin.org/json and extract all fields" --model o3-mini --launch

# Force provider explicitly
kuskus run "..." --provider openai --model gpt-4o-mini --launch

# Interactive REPL
kuskus repl --launch
kuskus repl --model gpt-4o --launch

# Extract data as JSON
kuskus run "go to news.ycombinator.com, extract title and URL of each front page post" --launch --output json

# Batch tasks
kuskus script ./tasks.json --model gpt-4o --output json
```

---

## Development

```bash
git clone https://github.com/porcupine/kuskus
cd kuskus
npm install
cp .env.example .env

# Run tests
npm test

# Try the CLI
node bin/cli.js install         # download Chromium for Testing
node bin/cli.js run "..." --launch
```

### Project structure

```
kuskus/
├── bin/
│   └── cli.js              CLI entrypoint (run/repl/script/mcp/install)
├── src/
│   ├── cdp/
│   │   ├── client.js       WebSocket CDP client + session multiplexing
│   │   ├── session.js      Target/tab manager
│   │   └── domains/
│   │       ├── page.js     Navigate, screenshot, reload
│   │       ├── dom.js      querySelector, getBoxModel, focus
│   │       ├── input.js    Click, hover, scroll, key press
│   │       ├── runtime.js  Evaluate JS
│   │       ├── network.js  Request monitoring/intercept
│   │       └── target.js   Multi-tab management
│   ├── agent/
│   │   ├── index.js        KuskusAgent orchestrator
│   │   ├── planner.js      LLM planning loop (provider-agnostic)
│   │   ├── providers.js    Anthropic + OpenAI adapters, auto-detection
│   │   ├── executor.js     Tool → CDP command mapping
│   │   ├── tools.js        Tool definitions (JSON Schema)
│   │   ├── memory.js       Rolling step history
│   │   └── prompts.js      System prompt
│   ├── mcp/
│   │   ├── server.js       MCP server (stdio transport)
│   │   └── handlers.js     Tool + resource handlers
│   └── utils/
│       ├── chromium.js     Chrome/Chromium detector + downloader
│       ├── browser.js      Launch + CDP readiness check
│       ├── dom-to-text.js  HTML → readable text for LLM
│       ├── screenshot.js   Save screenshots to disk
│       └── logger.js       Structured logger (pino)
├── tests/
└── examples/
```

---

## License

MIT
