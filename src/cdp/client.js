import { EventEmitter } from 'events';
import WebSocket from 'ws';
import logger from '../utils/logger.js';

const DEFAULT_TIMEOUT = 30_000;

/**
 * Low-level CDP client over WebSocket.
 * Supports both browser-level and page-level (session) connections.
 */
export class CDPClient extends EventEmitter {
  #ws = null;
  #pending = new Map();   // id → { resolve, reject, timer }
  #nextId = 1;
  #sessionId = null;

  constructor({ url, sessionId = null } = {}) {
    super();
    this.url = url;
    this.#sessionId = sessionId;
  }

  get sessionId() { return this.#sessionId; }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.#ws = ws;

      ws.once('open', () => {
        logger.debug({ url: this.url }, 'CDP WebSocket connected');
        resolve();
      });

      ws.once('error', (err) => {
        reject(err);
      });

      ws.on('message', (data) => {
        this.#onMessage(JSON.parse(data.toString()));
      });

      ws.on('close', (code, reason) => {
        logger.debug({ code }, 'CDP WebSocket closed');
        this.emit('disconnected', { code, reason: reason.toString() });
        // Reject all pending
        for (const [id, { reject: rej, timer }] of this.#pending) {
          clearTimeout(timer);
          rej(new Error(`CDP connection closed (code ${code})`));
          this.#pending.delete(id);
        }
      });
    });
  }

  #onMessage(msg) {
    // Flat event (browser-level)
    if (msg.method) {
      const event = this.#sessionId ? `${this.#sessionId}.${msg.method}` : msg.method;
      this.emit(msg.method, msg.params);
      this.emit(event, msg.params);
      return;
    }

    // Session-multiplexed event
    if (msg.sessionId && msg.method === undefined && msg.id === undefined) {
      this.emit(`session.${msg.sessionId}`, msg);
      return;
    }

    // Response to a command
    if (msg.id !== undefined) {
      const entry = this.#pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.#pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message || 'CDP error');
        err.code = msg.error.code;
        err.data = msg.error.data;
        entry.reject(err);
      } else {
        entry.resolve(msg.result ?? {});
      }
    }
  }

  /**
   * Send a CDP command and return the result.
   * @param {string} method
   * @param {object} [params]
   * @param {number} [timeout]
   * @returns {Promise<object>}
   */
  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket is not open'));
      }

      const id = this.#nextId++;
      const msg = { id, method, params };
      if (this.#sessionId) msg.sessionId = this.#sessionId;

      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });

      logger.debug({ method, params }, 'CDP →');
      this.#ws.send(JSON.stringify(msg));
    });
  }

  async close() {
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }
}
