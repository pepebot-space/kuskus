# Kuskus — Local Chrome Automation

<p align="center">
  <img src="assets/logo.png" alt="Kuskus Logo" width="300"/>
</p>

This repository refactors the former Kuskus project into a lightweight implementation of the [Kuskus](https://github.com/kuskus/mcp) server. It ships a stdio MCP server, a typed tool catalog, and a Chrome extension that you can load locally. Together they let any MCP-capable client (Claude Desktop, Cursor, Windsurf, etc.) automate your existing Chrome session without uploading data to a remote service.

---

## What’s Included

- **CLI / MCP server** – `bin/mcp.js` starts a stdio server that exposes Kuskus tools.
- **Tool implementations** – Zod-validated schemas and handlers under `src/tools/` covering navigation, interaction, snapshots, and screenshots.
- **WebSocket bridge** – `src/context.js` + `src/ws.js` manage the single active Chrome connection.
- **Chrome extension** – `extension/` contains a Manifest V3 service worker and popup UI. The CLI loads it automatically when launching its own browser, but you can also install it manually if you prefer to attach to an existing Chrome session.
- **Auto-launcher** – the CLI discovers (or downloads) a Chrome/Chromium binary, launches it with `--load-extension`, and provisions an isolated profile + helper symlink.

Everything runs locally: the extension drives your active browser tab, and the MCP server simply forwards tool requests from the host application over a localhost WebSocket.

---

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run the CLI (auto mode)**
   ```bash
   npm start
   ```
   or directly via
   ```bash
   npx @porcupine/kuskus
   ```
   The CLI detects your OS, locates Google Chrome (or Chromium). If nothing suitable is found it downloads the latest Chrome-for-Testing build into `~/.local/kuskus/chrome/` (with a helper symlink at `~/.local/bin/kuskus-chrome`). It then launches the browser with the bundled extension via `--load-extension` and waits for the extension to connect automatically.

3. **(Optional) Manual extension install**
   If you want to use your own browser session instead of the auto-launched one:
   - Open `chrome://extensions`
   - Enable *Developer mode*
   - Click **Load unpacked** and select the `extension/` directory
   - Click **Connect** in the popup; also set `KUSKUS_SKIP_LAUNCH=true` before running the CLI so it attaches to your existing browser.

4. **Attach from your MCP client**
   ```bash
   mcp-server-kuskus
   ```
   (installed with this package). The server communicates over stdio, so no additional arguments are required.

> The auto-launched browser uses a dedicated user-data directory (`~/.local/kuskus/profile`) so it won’t interfere with your main Chrome profile.

---

## CLI Commands

The same executable also exposes a lightweight CLI so you can trigger tools directly from the terminal (handy for quick smoke tests once the extension is connected).

```bash
# List available tools
npx @porcupine/kuskus list

# Call a tool once (payload via inline JSON)
npx @porcupine/kuskus call browser.navigate --payload '{"url":"https://example.com"}'

# Call a tool using payload from file and save images to disk
npx @porcupine/kuskus call browser.screenshot --output ./screenshot.png

# Use the LLM agent to plan and execute multiple steps (requires OPENAI_API_KEY)
npx @porcupine/kuskus run "Find the latest Mac Mini prices on Tokopedia"
```

When you run a command that talks to the browser, the CLI launches (or reuses) the Chrome instance described above, loads the bundled extension, and waits for it to connect. If you disable the auto-launch behaviour (`KUSKUS_SKIP_LAUNCH=true`), make sure the popup in your existing browser displays “Connected” before invoking commands.

> **Note:** the `run` command uses OpenAI's Chat Completions API by default. Set `OPENAI_API_KEY` (and optionally `KUSKUS_MODEL`) in your environment to enable it.

Once connected, browser actions issued by the host will execute against your currently selected Chrome tab. Auto-launched runs use a dedicated profile directory so your main browser profile stays untouched; if you attach manually, the CLI leaves your existing cookies, logins, and extensions intact.

---

## Automatic Chrome Provisioning

- On Linux/macOS/Windows, the CLI scans for existing Chrome/Chromium binaries. If none are found it fetches the latest *Chrome for Testing* build, extracts it under `~/.local/kuskus/chrome/<version>/` (or `%LOCALAPPDATA%\kuskus\chrome\<version>%` on Windows), and places a convenience symlink at `~/.local/bin/kuskus-chrome` (Unix) or keeps the executable alongside the download on Windows.
- Auto-launched sessions reuse a dedicated profile directory (`~/.local/kuskus/profile`) so caches, cookies, and extension state remain isolated from your primary browser profile.
- Set `KUSKUS_CHROME_PATH` to point at a specific binary or `KUSKUS_SKIP_LAUNCH=true` if you want to manage the browser yourself.

---

### Common CLI Options

All subcommands accept runtime overrides that mirror the environment variables:

- `--agent-model <name>` – set the default agent model (env: `KUSKUS_MODEL`).
- `--ws-port <port>` – change the extension WebSocket port (`KUSKUS_WS_PORT`).
- `--timeout <ms>` – adjust tool response timeout (`KUSKUS_TOOL_TIMEOUT`).
- `--debug`/`--no-debug` – toggle verbose logging (`KUSKUS_DEBUG`).
- `--debug-port <port>` – pick a Chrome remote debugging port (`KUSKUS_CDP_PORT`).
- `--chrome-path <path>` – point at an existing Chrome/Chromium binary (`KUSKUS_CHROME_PATH`).
- `--skip-launch` – attach to a manually launched browser (`KUSKUS_SKIP_LAUNCH`).
- `--extension-dir <path>` – load a different unpacked extension (`KUSKUS_EXTENSION_DIR`).
- `--profile-dir <path>` – change the auto-launched profile directory (`KUSKUS_PROFILE_DIR`).
- `--data-dir <path>` – relocate downloads/cache (`KUSKUS_DATA_DIR`).
- `--bin-dir <path>` – override the helper symlink/executable directory (`KUSKUS_BIN_DIR`).

These flags are applied before Chrome is detected or launched, letting you customise behaviour per invocation without editing `.env`.

> Tip: run once with `--extension-dir /path/to/extension` to copy that bundle into `~/.local/kuskus/extension/`. Future sessions will use the copied version automatically, even if you omit the flag.

---

## Available Tools

| Tool name | Description | Parameters |
|-----------|-------------|------------|
| `browser.navigate` | Navigate the active tab to a URL. | `{ url: string }` |
| `browser.goBack` | Go back one step in history. | — |
| `browser.goForward` | Go forward one step in history. | — |
| `browser.wait` | Pause execution for N seconds (max 120). | `{ time: number }` |
| `browser.pressKey` | Dispatch a keyboard key to the focused element. | `{ key: string }` |
| `browser.snapshot` | Return URL, title, and a YAML-formatted ARIA snapshot. | — |
| `browser.click` | Click an element by CSS selector. | `{ selector: string }` |
| `browser.hover` | Hover an element by CSS selector. | `{ selector: string }` |
| `browser.type` | Type text into an element (optionally replace). | `{ selector: string, text: string, replace?: boolean }` |
| `browser.selectOption` | Select a value in a `<select>` element. | `{ selector: string, value: string }` |
| `browser.drag` | Drag from one selector to another. | `{ sourceSelector: string, targetSelector: string }` |
| `browser.screenshot` | Capture a PNG of the visible tab. | — |
| `browser.getConsoleLogs` | Retrieve buffered console logs captured by the extension. | — |

Most interaction tools return a fresh snapshot so downstream reasoning models can see page changes without issuing another command.

---

## Chrome Extension

- **Popup (`popup.html`)** provides status, port selection, and connect/disconnect controls.
- **Service worker (`service_worker.js`)** maintains the WebSocket connection, injects lightweight DOM helpers, and mirrors Kuskus’s JSON message format.
- Actions run inside the user’s tab via `chrome.scripting.executeScript`, ensuring they inherit the real browser fingerprint.

If you switch to another Chrome tab, click “Connect” again to update the active target.

---

## Configuration

Use environment variables to tweak the runtime:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | Required for the `run` CLI command (LLM agent) |
| `KUSKUS_MODEL` | `gpt-4o-mini` | Override the OpenAI model used by the agent |
| `KUSKUS_WS_PORT` | `58338` | WebSocket port used by the extension and server |
| `KUSKUS_TOOL_TIMEOUT` | `30000` | Timeout for extension responses |
| `KUSKUS_DEBUG` | `false` | Enable verbose server logging |
| `KUSKUS_CHROME_PATH` | — | Provide a custom Chrome/Chromium binary path (skips auto detection) |
| `KUSKUS_SKIP_LAUNCH` | `false` | Set to `true` to attach to an already-running browser/extension |
| `KUSKUS_CDP_PORT` | `9222` | Remote debugging port used when launching Chrome |
| `KUSKUS_PROFILE_DIR` | `~/.local/kuskus/profile` | Custom user-data dir for the auto-launched browser |
| `KUSKUS_DATA_DIR` | `~/.local/kuskus` | Base directory for downloaded binaries and state |
| `KUSKUS_BIN_DIR` | `~/.local/bin` (Unix) / `%LOCALAPPDATA%\kuskus\bin` (Windows) | Directory that receives the helper symlink/executable |
| `KUSKUS_EXTENSION_DIR` | `<repo>/extension` | Directory that will be loaded via `--load-extension` |

The CLI reads `.env` automatically if present (via Node’s standard `process.env`). If you change the WebSocket port while auto-launch is enabled, also update the extension (via the popup) or run with `KUSKUS_SKIP_LAUNCH=true` and connect manually.

---

## Integration Examples

### Claude Desktop

```json
{
  "mcpServers": {
    "kuskus": {
      "command": "mcp-server-kuskus"
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "kuskus": {
      "command": "npx",
      "args": ["@porcupine/kuskus"]
    }
  }
}
```

Because the server uses stdio, no ports need to be exposed to the MCP host. Only the extension speaks over `ws://127.0.0.1:{port}`.

---

## Project Structure

```
kuskus/
├── bin/
│   └── mcp.js               # CLI bootstrap (delegates to src/index.js)
├── src/
│   ├── config.js            # App + runtime configuration
│   ├── context.js           # WebSocket request/response broker
│   ├── server.js            # MCP server factory
│   ├── ws.js                # WebSocket server utilities
│   ├── tools/               # Tool schemas + handlers
│   ├── utils/               # Logging, port helpers, snapshot builder
│   └── resources/           # Resource helpers (placeholder for future)
├── extension/
│   ├── manifest.json
│   ├── popup.html / popup.js
│   └── service_worker.js
├── SPEC.md                  # High-level specification & roadmap
└── package.json
```

---

## Roadmap

- Expand the toolset to include scrolling, JavaScript evaluation, and richer resources.
- Stream artifacts (screenshots, DOM dumps) as MCP resources rather than inline tool results.
- Investigate porting additional Kuskus monorepo utilities (e.g., messaging helpers) to tighten parity with upstream.

Contributions and bug reports are welcome. If you plan to extend the extension or add new tools, update `SPEC.md` with the planned behavior so host integrations stay predictable.
