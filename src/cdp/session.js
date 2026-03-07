import http from 'http';
import { CDPClient } from './client.js';
import logger from '../utils/logger.js';

/**
 * Manages browser-level connection and per-target (tab) sessions.
 */
export class SessionManager {
  #browserClient = null;
  #sessions = new Map();   // targetId → CDPClient
  #activeTargetId = null;
  #host;
  #port;

  constructor({ host = 'localhost', port = 9222 } = {}) {
    this.#host = host;
    this.#port = port;
  }

  get wsBase() {
    return `ws://${this.#host}:${this.#port}`;
  }

  get httpBase() {
    return `http://${this.#host}:${this.#port}`;
  }

  /**
   * Connect to the browser-level CDP endpoint.
   */
  async connect() {
    const info = await this.#httpGet('/json/version');
    const wsUrl = info.webSocketDebuggerUrl || `${this.wsBase}/json`;
    this.#browserClient = new CDPClient({ url: wsUrl });
    await this.#browserClient.connect();
    logger.info({ browser: info.Browser }, 'Connected to browser');
    return this;
  }

  /**
   * List all open targets (tabs/pages).
   * @returns {Promise<object[]>}
   */
  async listTargets() {
    return this.#httpGet('/json/list');
  }

  /**
   * Attach to an existing target (tab) and return a CDPClient for it.
   * Caches by targetId.
   * @param {string} targetId
   * @returns {Promise<CDPClient>}
   */
  async attachTarget(targetId) {
    if (this.#sessions.has(targetId)) {
      this.#activeTargetId = targetId;
      return this.#sessions.get(targetId);
    }

    const targets = await this.listTargets();
    const target = targets.find((t) => t.id === targetId);
    if (!target) throw new Error(`Target not found: ${targetId}`);

    const client = new CDPClient({ url: target.webSocketDebuggerUrl });
    await client.connect();
    await this.#enableDomains(client);

    this.#sessions.set(targetId, client);
    this.#activeTargetId = targetId;
    logger.debug({ targetId, url: target.url }, 'Attached to target');
    return client;
  }

  /**
   * Create a new tab, optionally navigating to url.
   * @param {string} [url]
   * @returns {Promise<CDPClient>}
   */
  async createTarget(url = 'about:blank') {
    const { targetId } = await this.#browserClient.send('Target.createTarget', { url });
    return this.attachTarget(targetId);
  }

  /**
   * Close a target (tab).
   * @param {string} targetId
   */
  async closeTarget(targetId) {
    const client = this.#sessions.get(targetId);
    if (client) {
      await client.close();
      this.#sessions.delete(targetId);
    }
    if (this.#activeTargetId === targetId) this.#activeTargetId = null;
  }

  /**
   * Return the active tab's CDPClient.
   * Auto-attaches to the first available page target if needed.
   * @returns {Promise<CDPClient>}
   */
  async getActiveSession() {
    if (this.#activeTargetId && this.#sessions.has(this.#activeTargetId)) {
      return this.#sessions.get(this.#activeTargetId);
    }

    const targets = await this.listTargets();
    const page = targets.find((t) => t.type === 'page');
    if (!page) {
      return this.createTarget('about:blank');
    }
    return this.attachTarget(page.id);
  }

  async #enableDomains(client) {
    await Promise.all([
      client.send('Page.enable'),
      client.send('DOM.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
    ]);
  }

  async #httpGet(path) {
    return new Promise((resolve, reject) => {
      http.get(`${this.httpBase}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  async close() {
    for (const client of this.#sessions.values()) await client.close();
    this.#sessions.clear();
    if (this.#browserClient) await this.#browserClient.close();
  }
}
