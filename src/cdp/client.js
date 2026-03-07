import { EventEmitter } from 'events';
import WebSocket from 'ws';
import logger from '../utils/logger.js';

const DEFAULT_TIMEOUT = 30_000;

/**
 * Browser-level CDP client over a single WebSocket.
 * Handles session multiplexing — all page sessions share this one connection.
 */
export class CDPClient extends EventEmitter {
  #ws = null;
  #pending = new Map();   // id → { resolve, reject, timer }
  #sessions = new Map();  // sessionId → SessionClient
  #nextId = 1;

  constructor({ url } = {}) {
    super();
    this.url = url;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.#ws = ws;

      ws.once('open', () => {
        logger.debug({ url: this.url }, 'CDP WebSocket connected');
        resolve();
      });
      ws.once('error', reject);
      ws.on('message', (data) => this.#onMessage(JSON.parse(data.toString())));
      ws.on('close', (code) => {
        logger.debug({ code }, 'CDP WebSocket closed');
        this.emit('disconnected', { code });
        for (const [id, { reject: rej, timer }] of this.#pending) {
          clearTimeout(timer);
          rej(new Error(`CDP connection closed (code ${code})`));
          this.#pending.delete(id);
        }
      });
    });
  }

  #onMessage(msg) {
    // Session-scoped message → route to the right SessionClient
    if (msg.sessionId) {
      const sc = this.#sessions.get(msg.sessionId);
      if (sc) sc._deliver(msg);
      // Also resolve browser-level pending (responses have sessionId too)
      if (msg.id !== undefined) this.#resolveResponse(msg);
      return;
    }

    // Browser-level event
    if (msg.method) {
      logger.debug({ method: msg.method }, 'CDP ←');
      this.emit(msg.method, msg.params);
      return;
    }

    // Browser-level response
    if (msg.id !== undefined) {
      this.#resolveResponse(msg);
    }
  }

  #resolveResponse(msg) {
    const entry = this.#pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.#pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error.message || 'CDP error');
      err.code = msg.error.code;
      entry.reject(err);
    } else {
      entry.resolve(msg.result ?? {});
    }
  }

  /**
   * Send a browser-level CDP command (no sessionId).
   */
  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    return this.#sendRaw({ method, params }, timeout);
  }

  /**
   * Send a command scoped to a session.
   */
  sendSession(method, params = {}, sessionId, timeout = DEFAULT_TIMEOUT) {
    return this.#sendRaw({ method, params, sessionId }, timeout);
  }

  #sendRaw({ method, params, sessionId }, timeout) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket is not open'));
      }
      const id = this.#nextId++;
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;

      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });
      logger.debug({ method, sessionId }, 'CDP →');
      this.#ws.send(JSON.stringify(msg));
    });
  }

  /**
   * Create a SessionClient scoped to a specific targetSession.
   * @param {string} sessionId
   * @returns {SessionClient}
   */
  createSessionClient(sessionId) {
    if (this.#sessions.has(sessionId)) return this.#sessions.get(sessionId);
    const sc = new SessionClient(this, sessionId);
    this.#sessions.set(sessionId, sc);
    return sc;
  }

  removeSessionClient(sessionId) {
    this.#sessions.delete(sessionId);
  }

  async close() {
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }
}

/**
 * A page-level CDP client that multiplexes over a parent CDPClient.
 * Has the same send() / on() API so domain wrappers work unchanged.
 */
export class SessionClient extends EventEmitter {
  #browser;
  #sessionId;

  constructor(browserClient, sessionId) {
    super();
    this.#browser = browserClient;
    this.#sessionId = sessionId;
  }

  get sessionId() { return this.#sessionId; }

  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    return this.#browser.sendSession(method, params, this.#sessionId, timeout);
  }

  /** Called by the parent CDPClient to deliver session-scoped messages. */
  _deliver(msg) {
    if (msg.method) {
      logger.debug({ method: msg.method, sessionId: this.#sessionId }, 'CDP ←');
      this.emit(msg.method, msg.params);
    }
    // Response resolution is handled by the browser client's #pending map.
  }
}
