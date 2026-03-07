import http from 'http';
import { CDPClient } from './client.js';
import logger from '../utils/logger.js';

/**
 * Manages the browser-level CDP connection and per-target sessions.
 * Uses a single WebSocket with session multiplexing (Lightpanda style).
 */
export class SessionManager {
  #browser = null;        // CDPClient (browser-level)
  #sessions = new Map();  // targetId → SessionClient
  #activeTargetId = null;
  #host;
  #port;
  capabilities = { screenshot: true }; // updated after connect

  constructor({ host = '127.0.0.1', port = 9222 } = {}) {
    this.#host = host;
    this.#port = port;
  }

  get httpBase() { return `http://${this.#host}:${this.#port}`; }
  get wsBase()   { return `ws://${this.#host}:${this.#port}`; }

  /**
   * Connect to the browser-level CDP WebSocket.
   */
  async connect() {
    const wsUrl = await this.#getBrowserWsUrl();
    this.#browser = new CDPClient({ url: wsUrl });
    await this.#browser.connect();

    // Forward Target events so callers can react to new/destroyed targets
    this.#browser.on('Target.targetDestroyed', ({ targetId }) => {
      this.#sessions.delete(targetId);
      if (this.#activeTargetId === targetId) this.#activeTargetId = null;
    });

    logger.info({ wsUrl }, 'Connected to browser');
    return this;
  }

  /**
   * List all page targets via CDP.
   */
  async listTargets() {
    const { targetInfos } = await this.#browser.send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'page');
  }

  /**
   * Attach to an existing target by targetId.
   * @param {string} targetId
   * @returns {Promise<SessionClient>}
   */
  async attachTarget(targetId) {
    if (this.#sessions.has(targetId)) {
      this.#activeTargetId = targetId;
      return this.#sessions.get(targetId);
    }

    const { sessionId } = await this.#browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });

    const sc = this.#browser.createSessionClient(sessionId);
    await this.#enableDomains(sc);

    this.#sessions.set(targetId, sc);
    this.#activeTargetId = targetId;
    logger.debug({ targetId, sessionId }, 'Attached to target');
    return sc;
  }

  /**
   * Create a new page target, attach to it, and return its SessionClient.
   * @param {string} [url]
   */
  async createTarget(url = 'about:blank') {
    // Check existing targets first to avoid calling createTarget on single-target browsers
    const existing = await this.listTargets();
    if (existing.length > 0) {
      // Browser only supports one target (e.g. Lightpanda) — navigate existing session
      logger.debug({ url }, 'Single-target browser: navigating existing session');
      const sc = await this.attachTarget(existing[0].targetId);
      if (url !== 'about:blank') {
        const { createPageDomain } = await import('./domains/page.js');
        await createPageDomain(sc, this.capabilities).navigate(url);
      }
      return sc;
    }

    const { targetId } = await this.#browser.send('Target.createTarget', { url });
    return this.attachTarget(targetId);
  }

  /**
   * Close a target (tab).
   */
  async closeTarget(targetId) {
    const sc = this.#sessions.get(targetId);
    if (sc) {
      this.#browser.removeSessionClient(sc.sessionId);
      this.#sessions.delete(targetId);
    }
    if (this.#activeTargetId === targetId) this.#activeTargetId = null;
    await this.#browser.send('Target.closeTarget', { targetId }).catch(() => {});
  }

  /**
   * Return the active session, auto-creating a page target if needed.
   * @returns {Promise<SessionClient>}
   */
  async getActiveSession() {
    if (this.#activeTargetId && this.#sessions.has(this.#activeTargetId)) {
      return this.#sessions.get(this.#activeTargetId);
    }

    const targets = await this.listTargets();
    if (targets.length > 0) {
      return this.attachTarget(targets[0].targetId);
    }

    return this.createTarget('about:blank');
  }

  async #enableDomains(sc) {
    await Promise.all([
      sc.send('Page.enable'),
      sc.send('DOM.enable'),
      sc.send('Runtime.enable'),
      sc.send('Network.enable'),
    ]);
  }

  /**
   * Probe whether a CDP method is supported without risking a connection drop.
   * Lightpanda closes the WS on UnknownMethod, so we must not call unsupported methods.
   * We detect capabilities conservatively based on the browser WS URL shape:
   *   - Lightpanda: webSocketDebuggerUrl is bare  ws://host:port/
   *   - Chrome:     webSocketDebuggerUrl is        ws://host:port/devtools/browser/{uuid}
   */
  async #getBrowserWsUrl() {
    const info = await this.#httpGet('/json/version').catch(() => null);
    if (!info?.webSocketDebuggerUrl) return `${this.wsBase}/json`;

    const wsUrl = info.webSocketDebuggerUrl;
    // Detect Lightpanda by its bare WS URL (no /devtools/ path segment)
    const isLightpanda = !wsUrl.includes('/devtools/');
    this.capabilities = {
      screenshot: !isLightpanda,
    };
    logger.debug({ isLightpanda, capabilities: this.capabilities }, 'Browser capabilities');
    return wsUrl;
  }

  #httpGet(path) {
    return new Promise((resolve, reject) => {
      http.get(`${this.httpBase}${path}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  async close() {
    this.#sessions.clear();
    if (this.#browser) await this.#browser.close();
  }
}
