---
name: Kuskus CDP Tools
description: CDP-based browser automation CLI — navigate, inspect, and interact with Chrome via command line, no API key required
---

# Kuskus — CLI Navigation Guide

A Chrome DevTools Protocol (CDP) browser automation tool. Control Chrome directly from the terminal — no OpenAI key, no MCP server required.

## Installation

```bash
npm install -g @porcupine/kuskus@latest
# or use without installing:
npx @porcupine/kuskus@latest <command>
```

## Core CLI Pattern

```bash
kuskus call <tool> '<json-args>'
```

All tools accept JSON as the second argument. Tools with no parameters take `'{}'`.

---

## Navigation Tools

### `navigate` — Go to a URL

```bash
kuskus call navigate '{"url":"https://example.com"}'
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Full URL including scheme (`https://`) |

**What it returns:**

```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "status": 200,
  "textPreview": "Example Domain\nThis domain is for use in illustrative...",
  "fullTextLength": 1256,
  "mainContentAvailable": true,
  "htmlPreview": "<div><h1>Example Domain</h1><p>This domain is...",
  "formHints": [],
  "dataTestIds": [],
  "structuredData": [],
  "strategyHints": []
}
```

| Field | Description |
|-------|-------------|
| `url` | Final URL after any redirects |
| `title` | Page `<title>` |
| `status` | HTTP status code, `null` if unknown |
| `textPreview` | Main content as plain text (up to 8000 chars) — dense container heuristic |
| `fullTextLength` | Total character count of main content |
| `mainContentAvailable` | `true` if main content was detected |
| `htmlPreview` | Raw HTML of main content area (up to 4000 chars) |
| `formHints` | Array of form elements found: `{tag, type, name, id, placeholder, selector}` |
| `dataTestIds` | Array of `data-testid` attributes found on the page |
| `structuredData` | Parsed structured content (products, search results) where available |
| `strategyHints` | Warnings from kuskus, e.g. `"CAPTCHA detected"`, `"search guard triggered"` |

**Examples:**

```bash
# Simple page load
kuskus call navigate '{"url":"https://news.ycombinator.com"}'

# E-commerce product page
kuskus call navigate '{"url":"https://www.tokopedia.com/someproduct"}'
# structuredData will contain product info if available

# Login page — formHints will list all input fields
kuskus call navigate '{"url":"https://github.com/login"}'
```

**Caveats:**
- Waits for `domcontentloaded`, not full page load (images/fonts may still be loading)
- Direct navigation to Google/Bing/Yahoo search URLs is blocked by a search guard — it redirects to the homepage instead. Use the search input field via `type` + `pressKey` to search
- If `strategyHints` contains `"CAPTCHA detected"`, automated interaction may fail

---

### `goBack` — Go back in browser history

```bash
kuskus call goBack '{}'
```

**Parameters:** none

**Returns:**

```json
{
  "url": "https://previous.page/path",
  "title": "Previous Page Title"
}
```

**Examples:**

```bash
# Navigate to a page, then go back
kuskus call navigate '{"url":"https://github.com/explore"}'
kuskus call navigate '{"url":"https://github.com/trending"}'
kuskus call goBack '{}'
# → returns github.com/explore
```

---

### `goForward` — Go forward in browser history

```bash
kuskus call goForward '{}'
```

**Parameters:** none

**Returns:**

```json
{
  "url": "https://next.page/path",
  "title": "Next Page Title"
}
```

**Examples:**

```bash
# After going back, go forward again
kuskus call navigate '{"url":"https://github.com/explore"}'
kuskus call navigate '{"url":"https://github.com/trending"}'
kuskus call goBack '{}'    # → explore
kuskus call goForward '{}' # → trending
```

---

### `reload` — Reload the current page

```bash
kuskus call reload '{}'
```

**Parameters:** none

**Returns:**

```json
{
  "url": "https://current.page/path",
  "title": "Current Page Title"
}
```

**Examples:**

```bash
# Navigate then reload (useful after login redirects settle)
kuskus call navigate '{"url":"https://dashboard.example.com"}'
kuskus call reload '{}'

# Force reload after a form submission to see updated data
kuskus call reload '{}'
```

---

## Practical Workflows

### Read content from a page

```bash
# Step 1: Navigate
kuskus call navigate '{"url":"https://blog.example.com/some-article"}'
# textPreview in the response already contains the article body

# Or use readPage for cleaner extraction after navigating
kuskus call readPage '{}'
```

### Inspect a page after navigating (find selectors)

```bash
# snapshot gives you the DOM tree — use it to find CSS selectors
kuskus call navigate '{"url":"https://github.com/login"}'
kuskus call snapshot '{}'
```

### Take a screenshot after navigating

```bash
kuskus call navigate '{"url":"https://example.com"}'
kuskus call screenshot '{}'
# Returns base64-encoded PNG
```

### Multi-step navigation session

```bash
# Each call reuses the same browser instance within a session
kuskus call navigate '{"url":"https://news.ycombinator.com"}'
kuskus call navigate '{"url":"https://news.ycombinator.com/item?id=12345"}'
kuskus call goBack '{}'   # back to HN front page
kuskus call reload '{}'   # refresh to get latest
```

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--headless <bool>` | `true` | `false` opens a visible Chrome window |
| `--debug` | `false` | Verbose logs: `[CDP]`, `[TOOL]`, `[MCP]` categories |
| `--cdp-port <port>` | — | Use a fixed CDP port for persistent sessions across calls |
| `--chrome-path <path>` | auto | Path to Chrome/Chromium binary |

```bash
# Watch navigation happen in a real browser window
npx @porcupine/kuskus@latest call --headless false navigate '{"url":"https://example.com"}'

# Debug CDP events step by step
npx @porcupine/kuskus@latest call --debug navigate '{"url":"https://example.com"}'

# Use a specific Chrome install
npx @porcupine/kuskus@latest call --chrome-path /usr/bin/chromium navigate '{"url":"https://example.com"}'
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KUSKUS_HEADLESS` | `true` | Headless browser mode |
| `KUSKUS_CDP_PORT` | — | Fix CDP port for persistent sessions; Chrome stays alive between calls |
| `KUSKUS_WAIT_UNTIL` | `domcontentloaded` | Navigation wait strategy: `domcontentloaded` \| `load` \| `networkidle0` \| `networkidle2` |
| `KUSKUS_DEBUG` | `false` | Enable debug logging |
| `KUSKUS_NAV_TIMEOUT` | `30000` | Navigation timeout in ms |
| `KUSKUS_TOOL_TIMEOUT` | `15000` | Tool timeout in ms |
| `KUSKUS_VIEWPORT_WIDTH` | `1280` | Browser viewport width |
| `KUSKUS_VIEWPORT_HEIGHT` | `720` | Browser viewport height |
| `KUSKUS_CHROME_PATH` | — | Custom Chrome binary path |

**Persistent sessions** — set `KUSKUS_CDP_PORT` to keep Chrome alive between calls. Kuskus launches Chrome on the first call and reuses it on subsequent calls instead of opening a new one each time:

```bash
# Without KUSKUS_CDP_PORT: Chrome opens and closes on every call (stateless)
npx @porcupine/kuskus@latest call navigate '{"url":"https://example.com"}'

# With KUSKUS_CDP_PORT: Chrome stays alive, session persists across calls
KUSKUS_CDP_PORT=9222 npx @porcupine/kuskus@latest call navigate '{"url":"https://example.com"}'
KUSKUS_CDP_PORT=9222 npx @porcupine/kuskus@latest call readPage '{}'
KUSKUS_CDP_PORT=9222 npx @porcupine/kuskus@latest call evaluate '{"expression":"document.title"}'
```

**`KUSKUS_WAIT_UNTIL`** — use `networkidle2` for JS-heavy SPAs that render content after the initial DOM:

```bash
# Static pages (default)
npx @porcupine/kuskus@latest call navigate '{"url":"https://example.com"}'

# JS-heavy SPA (Google Trends, dashboards, etc.)
KUSKUS_WAIT_UNTIL=networkidle2 npx @porcupine/kuskus@latest call navigate '{"url":"https://trends.google.com/trending?geo=ID"}'
```

- `domcontentloaded` (default) — fast, good for most sites
- `networkidle2` — waits until ≤2 open connections for 500ms; for SPAs
- `load` — waits for all resources including images
- `networkidle0` — strictest; avoid on pages with long-polling

---

## Chrome Auto-Download

No Chrome install required. Kuskus resolves Chrome in this order:

1. `KUSKUS_CHROME_PATH` / `--chrome-path` (your explicit override)
2. System Chrome/Chromium (checks standard OS paths)
3. Cached build in `~/.local/chrome/`
4. Auto-downloads **Chrome for Testing** from Google's CDN

Supported: macOS (arm64/x64), Linux (x64), Windows (x86/x64).
Downloaded builds are cached in `~/.local/chrome/<version>/` and reused on subsequent runs.

---

## List All Available Tools

```bash
kuskus list
```

Output shows all 23 tools with descriptions. Navigation tools are the first group: `navigate`, `goBack`, `goForward`, `reload`.
