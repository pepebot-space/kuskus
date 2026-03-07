# CDP Browser Agent — Project Specification

## Overview

A Node.js-based AI agent that controls a browser via the Chrome DevTools Protocol (CDP),
similar to browser-use but without Playwright. The agent receives natural language tasks,
translates them into CDP commands, and executes them against a running Lightpanda browser.

Ships as two artifacts:
- **CLI** — interactive / scripted terminal usage
- **MCP Server** — Model Context Protocol server for integration with Claude Desktop, Cursor, etc.

---

## Browser Runtime

**Lightpanda** (`github.com/lightpanda-io/browser`)
- Headless browser with native CDP support
- Chromium-compatible DevTools Protocol endpoint
- Starts with: `lightpanda --remote-debugging-port=9222`
- CDP WebSocket URL: `ws://localhost:9222/json` → enumerate targets, then connect per-target

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Entry Points                    │
│  ┌──────────────────┐  ┌────────────────────┐   │
│  │      CLI          │  │    MCP Server       │   │
│  │  (bin/cli.js)     │  │  (bin/mcp.js)       │   │
│  └────────┬─────────┘  └────────┬───────────┘   │
└───────────┼─────────────────────┼───────────────┘
            │                     │
            └──────────┬──────────┘
                       ▼
          ┌────────────────────────┐
          │       Agent Core        │
          │  (src/agent/index.js)   │
          │  - Task planner         │
          │  - Step executor        │
          │  - Memory / context     │
          └────────────┬───────────┘
                       │
          ┌────────────▼───────────┐
          │     Browser Client      │
          │  (src/cdp/client.js)    │
          │  - CDP WebSocket conn   │
          │  - Domain managers      │
          └────────────┬───────────┘
                       │
          ┌────────────▼───────────┐
          │   Lightpanda Browser    │
          │  CDP ws://localhost:9222│
          └────────────────────────┘
```

---

## Directory Structure

```
cdp-browser-agent/
├── package.json
├── .env.example
├── bin/
│   ├── cli.js            # CLI entrypoint
│   └── mcp.js            # MCP server entrypoint
├── src/
│   ├── cdp/
│   │   ├── client.js     # Low-level CDP WebSocket client
│   │   ├── session.js    # Session / target management
│   │   └── domains/
│   │       ├── page.js       # Page domain (navigate, screenshot, reload)
│   │       ├── dom.js        # DOM domain (query, describe, highlight)
│   │       ├── input.js      # Input domain (mouse, keyboard, touch)
│   │       ├── runtime.js    # Runtime domain (evaluate JS)
│   │       ├── network.js    # Network domain (intercept, monitor)
│   │       └── target.js     # Target domain (tabs management)
│   ├── agent/
│   │   ├── index.js      # Agent orchestrator
│   │   ├── planner.js    # LLM-based task planner
│   │   ├── executor.js   # Tool call executor
│   │   ├── tools.js      # Tool definitions (schema + handlers)
│   │   ├── memory.js     # Short-term context window manager
│   │   └── prompts.js    # System prompts
│   ├── mcp/
│   │   ├── server.js     # MCP server setup (stdio transport)
│   │   └── handlers.js   # MCP tool/resource handlers
│   └── utils/
│       ├── screenshot.js # Screenshot capture + base64 encode
│       ├── dom-to-text.js # DOM serializer → readable text/markdown
│       └── logger.js     # Structured logger (pino)
├── tests/
│   ├── cdp/
│   └── agent/
└── examples/
    ├── search-google.js
    └── fill-form.js
```

---

## Core Modules

### 1. CDP Client (`src/cdp/client.js`)

Connects to the Lightpanda CDP endpoint via WebSocket.

```js
// Interface
class CDPClient {
  constructor(options: { host, port, targetId? })
  async connect(): Promise<void>
  async send(method: string, params?: object): Promise<any>
  on(event: string, handler: Function): void
  async close(): Promise<void>
}
```

- Uses `ws` npm package
- Implements CDP message ID tracking (auto-increment)
- Handles CDP events as EventEmitter
- Reconnect logic with exponential backoff (max 5 attempts)
- Per-session multiplexing via `sessionId` for multi-tab support

### 2. Session Manager (`src/cdp/session.js`)

```js
class SessionManager {
  async listTargets(): Promise<Target[]>
  async attachTarget(targetId: string): Promise<CDPClient>
  async createTarget(url?: string): Promise<CDPClient>
  async closeTarget(targetId: string): Promise<void>
  async getActiveSession(): Promise<CDPClient>
}
```

### 3. CDP Domains

Each domain wraps CDP method calls into ergonomic async functions:

**Page domain:**
- `navigate(url)` → `Page.navigate`
- `screenshot(options?)` → `Page.captureScreenshot`
- `pdf(options?)` → `Page.printToPDF`
- `reload()` → `Page.reload`
- `waitForLoad()` → listen `Page.loadEventFired`
- `getContent()` → `Page.getResourceContent`
- `setDialogBehavior(action)` → `Page.handleJavaScriptDialog`

**DOM domain:**
- `querySelector(selector)` → `DOM.querySelector`
- `querySelectorAll(selector)` → `DOM.querySelectorAll`
- `getDocument()` → `DOM.getDocument`
- `getOuterHTML(nodeId)` → `DOM.getOuterHTML`
- `setAttributeValue(nodeId, name, value)` → `DOM.setAttributeValue`
- `focus(nodeId)` → `DOM.focus`
- `getBoxModel(nodeId)` → `DOM.getBoxModel`
- `scrollIntoView(nodeId)` → `DOM.scrollIntoViewIfNeeded`

**Input domain:**
- `click(x, y)` → `Input.dispatchMouseEvent` (move + down + up)
- `clickSelector(selector)` → resolve node center coords → click
- `type(text)` → `Input.dispatchKeyEvent` per char
- `keyPress(key)` → `Input.dispatchKeyEvent`
- `scroll(x, y, deltaX, deltaY)` → `Input.dispatchMouseEvent` scroll
- `hover(x, y)` → `Input.dispatchMouseEvent` mouseMoved

**Runtime domain:**
- `evaluate(expression)` → `Runtime.evaluate`
- `callFunctionOn(funcDecl, objectId, args)` → `Runtime.callFunctionOn`
- `getProperties(objectId)` → `Runtime.getProperties`

**Network domain:**
- `enable()` / `disable()`
- `setRequestInterception(patterns)` → `Fetch.enable`
- `continueRequest(requestId)` → `Fetch.continueRequest`
- `getResponseBody(requestId)` → `Network.getResponseBody`

---

## Agent Core

### Tool Definitions (`src/agent/tools.js`)

The agent operates via tool calls. Tools map directly to CDP domain actions:

| Tool Name            | Description                                      | Key Params                        |
|----------------------|--------------------------------------------------|-----------------------------------|
| `navigate`           | Navigate browser to URL                          | `url: string`                     |
| `screenshot`         | Capture current viewport as base64 PNG           | `fullPage?: boolean`              |
| `click`              | Click an element by CSS selector                 | `selector: string`                |
| `click_coords`       | Click at specific x,y coordinates                | `x: number, y: number`            |
| `type_text`          | Type text into focused/selected element          | `selector: string, text: string`  |
| `key_press`          | Press a keyboard key                             | `key: string`                     |
| `scroll`             | Scroll page or element                           | `direction: up\|down, amount: number` |
| `hover`              | Hover over element                               | `selector: string`                |
| `get_page_content`   | Get readable text of current page (DOM→text)     | `format: text\|markdown\|html`    |
| `evaluate_js`        | Execute JavaScript in page context               | `script: string`                  |
| `wait`               | Wait N milliseconds                              | `ms: number`                      |
| `get_url`            | Get current page URL                             | —                                 |
| `new_tab`            | Open a new browser tab                           | `url?: string`                    |
| `close_tab`          | Close current or specified tab                   | `targetId?: string`               |
| `switch_tab`         | Switch active tab                                | `targetId: string`                |
| `list_tabs`          | List all open tabs                               | —                                 |
| `go_back`            | Browser back                                     | —                                 |
| `go_forward`         | Browser forward                                  | —                                 |
| `get_element_info`   | Get attributes/text of an element                | `selector: string`                |
| `select_option`      | Select a `<select>` option by value/label        | `selector: string, value: string` |
| `set_checkbox`       | Check/uncheck checkbox                           | `selector: string, checked: bool` |
| `upload_file`        | Set file input value                             | `selector: string, path: string`  |
| `extract_data`       | Extract structured data from page                | `schema: object`                  |

### Planner (`src/agent/planner.js`)

- Uses Anthropic Claude API (`claude-sonnet-4-6` default, configurable)
- System prompt defines: agent role, available tools, output format, safety constraints
- Receives: user task + screenshot + page content + action history
- Returns: next tool call(s) or `finish` with result
- Max steps: configurable (default 20)
- Step loop:
  1. Capture screenshot + page content
  2. Build context message (task, history, current state)
  3. Call LLM with tool definitions
  4. Execute returned tool call
  5. Append to history
  6. Repeat until `finish` or max steps

### Memory (`src/agent/memory.js`)

- Rolling window of last N steps (default 10) to stay within context
- Each entry: `{ step, tool, params, result, screenshot_b64? }`
- Summarization: when history exceeds window, summarize oldest entries via LLM

---

## CLI (`bin/cli.js`)

### Usage

```bash
# One-shot task
cdp-agent run "go to github.com and star the lightpanda repo"

# Interactive REPL mode
cdp-agent repl

# Script mode (task file)
cdp-agent script ./tasks/my-task.json

# With custom browser endpoint
cdp-agent run "..." --cdp-url ws://localhost:9222

# With screenshot output
cdp-agent run "..." --screenshots ./output/

# Verbose CDP logging
cdp-agent run "..." --debug
```

### CLI Options

| Flag                | Default               | Description                          |
|---------------------|-----------------------|--------------------------------------|
| `--cdp-url`         | `ws://localhost:9222` | CDP WebSocket endpoint               |
| `--model`           | `claude-sonnet-4-6`   | Claude model to use                  |
| `--max-steps`       | `20`                  | Max agent steps before stopping      |
| `--screenshots`     | `null`                | Dir to save step screenshots         |
| `--headless`        | `true`                | Launch browser in headless mode      |
| `--launch`          | `false`               | Auto-launch Lightpanda before run    |
| `--launch-path`     | `lightpanda`          | Path to Lightpanda binary            |
| `--debug`           | `false`               | Log raw CDP messages                 |
| `--output`          | `text`                | Output format: `text`, `json`        |

### Interactive REPL Features

- Multi-line task input
- `!screenshot` command — capture and display screenshot
- `!tabs` — list open tabs
- `!history` — show action history
- `!clear` — reset agent memory
- `!exit` — quit
- Arrow key history navigation

---

## MCP Server (`bin/mcp.js`)

### Transport

- **stdio** (primary) — for Claude Desktop, Cursor integration
- **HTTP/SSE** (optional) — for remote/network access

### MCP Tools Exposed

Each agent tool is exposed as an MCP tool. Additionally:

| MCP Tool              | Description                                     |
|-----------------------|-------------------------------------------------|
| `browser_run_task`    | Run a full natural language agent task          |
| `browser_navigate`    | Navigate to URL                                 |
| `browser_screenshot`  | Capture screenshot (returns base64 image)       |
| `browser_click`       | Click element by selector                       |
| `browser_type`        | Type text into element                          |
| `browser_evaluate`    | Execute JavaScript                              |
| `browser_get_content` | Get page content as text/markdown               |
| `browser_extract`     | Extract structured data from page               |
| `browser_new_tab`     | Open new tab                                    |
| `browser_close_tab`   | Close a tab                                     |
| `browser_list_tabs`   | List open tabs                                  |

### MCP Resources

| Resource URI              | Description                            |
|---------------------------|----------------------------------------|
| `browser://screenshot`    | Current viewport screenshot            |
| `browser://page/content`  | Current page text content              |
| `browser://page/url`      | Current URL                            |
| `browser://tabs`          | List of open tabs as JSON              |

### Claude Desktop Config (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "cdp-browser-agent": {
      "command": "node",
      "args": ["/path/to/cdp-browser-agent/bin/mcp.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "CDP_URL": "ws://localhost:9222"
      }
    }
  }
}
```

---

## Configuration

### Environment Variables (`.env`)

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Browser
CDP_URL=ws://localhost:9222
CDP_LAUNCH_BROWSER=false
CDP_BROWSER_PATH=lightpanda
CDP_BROWSER_PORT=9222

# Agent
AGENT_MODEL=claude-sonnet-4-6
AGENT_MAX_STEPS=20
AGENT_MAX_TOKENS=4096
AGENT_INCLUDE_SCREENSHOT=true
AGENT_SCREENSHOT_QUALITY=80

# Logging
LOG_LEVEL=info
LOG_FORMAT=pretty
```

---

## Dependencies

```json
{
  "dependencies": {
    "ws": "^8.18.0",
    "@anthropic-ai/sdk": "^0.36.0",
    "@modelcontextprotocol/sdk": "^1.5.0",
    "commander": "^12.0.0",
    "dotenv": "^16.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "node-html-to-text": "^9.0.0",
    "ora": "^8.0.0",
    "chalk": "^5.3.0",
    "readline": "builtin"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "nock": "^13.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## Key Implementation Notes

### CDP Connection Flow

```
1. GET http://localhost:9222/json/version   → browser metadata
2. GET http://localhost:9222/json/list      → list targets (tabs)
3. WS  ws://localhost:9222/devtools/page/{targetId}  → connect to tab
4. Send: { id: 1, method: "Page.enable", params: {} }
5. Send: { id: 2, method: "DOM.enable", params: {} }
6. Send: { id: 3, method: "Runtime.enable", params: {} }
```

### Element Interaction Strategy

When clicking/typing by selector:
1. `DOM.querySelector` to get `nodeId`
2. `DOM.getBoxModel(nodeId)` to get element center coordinates
3. `DOM.scrollIntoViewIfNeeded(nodeId)` to ensure visibility
4. `Input.dispatchMouseEvent` with calculated center coords

### Screenshot + Vision Loop

Each agent step:
1. `Page.captureScreenshot` → base64 PNG
2. Include as `image` content block in Claude message
3. Also include DOM→text representation for accessibility tree fallback
4. Claude uses both visual and text signals to decide next action

### DOM to Readable Text

Convert raw DOM to a simplified representation for LLM:
- Preserve: links (href), buttons (text), inputs (type, placeholder, value), headings, lists, tables
- Strip: scripts, styles, hidden elements
- Add: `[BUTTON: text]`, `[INPUT: placeholder]`, `[LINK: text → href]` markers
- Truncate to ~8000 tokens

### Error Handling

- CDP command timeout: 30s default, configurable per domain
- Selector not found: retry once after 1s wait, then report to agent
- Navigation errors: capture and include in agent context
- Browser disconnect: attempt reconnect, fail gracefully after 3 attempts

---

## Testing Strategy

```
tests/
├── cdp/
│   ├── client.test.js        # Unit: WebSocket mock, message parsing
│   ├── page.test.js          # Integration: real Lightpanda instance
│   └── input.test.js         # Integration: click/type actions
├── agent/
│   ├── planner.test.js       # Unit: mock Claude API responses
│   ├── executor.test.js      # Unit: tool execution
│   └── tools.test.js         # Unit: tool schema validation
└── e2e/
    ├── navigate.test.js      # E2E: full navigate + screenshot
    └── form.test.js          # E2E: fill and submit form
```

Run: `npx vitest`
E2E requires Lightpanda running: `npx vitest --project=e2e`

---

## Phase Plan

### Phase 1 — CDP Foundation
- [ ] CDP WebSocket client with message handling
- [ ] Session/target manager
- [ ] Page, DOM, Input, Runtime domain wrappers
- [ ] Basic screenshot + DOM extraction utilities

### Phase 2 — Agent Core
- [ ] Tool definitions + JSON schemas
- [ ] Claude API integration (tool use loop)
- [ ] Step history / memory
- [ ] System prompts

### Phase 3 — CLI
- [ ] `run` command (one-shot)
- [ ] `repl` interactive mode
- [ ] `script` file mode
- [ ] Progress display with ora
- [ ] Screenshot saving

### Phase 4 — MCP Server
- [ ] MCP SDK integration (stdio transport)
- [ ] Expose all browser tools
- [ ] Screenshot as MCP image resource
- [ ] Claude Desktop config docs

### Phase 5 — Polish
- [ ] HTTP/SSE transport for MCP
- [ ] Auto-launch Lightpanda option
- [ ] Rate limiting + retry logic
- [ ] Structured logging
- [ ] E2E test suite

---

## Security Considerations

- Never expose MCP server on public network without auth
- Sandbox browser profile (no stored credentials/cookies by default)
- Configurable allowlist/blocklist for navigation URLs
- File upload limited to explicit user-provided paths
- `evaluate_js` tool should warn user — arbitrary JS execution
- No persistent browser storage by default (new profile each run)
