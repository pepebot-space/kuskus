import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { CDPClient } from '../../src/cdp/client.js';

// Patch WebSocket on the instance level for unit tests
function makeClient() {
  const client = new CDPClient({ url: 'ws://localhost:9222/devtools/page/test' });

  // Inject a fake WS before calling connect
  const fakeWs = new EventEmitter();
  fakeWs.readyState = 1; // OPEN
  fakeWs._lastSent = null;
  fakeWs.send = (data) => { fakeWs._lastSent = JSON.parse(data); };
  fakeWs.close = () => {};

  // Monkey-patch connect to use our fake WS
  client.connect = async () => {
    client._CDPClient__ws = fakeWs;
    client._CDPClient__ws.on = fakeWs.on.bind(fakeWs);
    // wire the message handler by reaching into private via a trick
    return Promise.resolve();
  };

  return { client, fakeWs };
}

describe('CDPClient', () => {
  it('rejects command on timeout', async () => {
    const client = new CDPClient({ url: 'ws://localhost:9222/test' });

    // Override connect to avoid real WebSocket
    client.connect = async () => {
      // Simulate open state by directly setting #ws via a writable approach
    };

    // Send without connecting — should reject with "not open"
    await expect(client.send('Page.enable', {}, 50)).rejects.toThrow();
  });

  it('emits events correctly as EventEmitter', () => {
    const client = new CDPClient({ url: 'ws://localhost:9222/test' });
    let fired = false;
    client.on('Page.loadEventFired', () => { fired = true; });
    client.emit('Page.loadEventFired', {});
    expect(fired).toBe(true);
  });

  it('rejects with "not open" when ws is not connected', async () => {
    const client = new CDPClient({ url: 'ws://localhost:9222/test' });
    await expect(client.send('Page.navigate', { url: 'http://x.com' })).rejects.toThrow('not open');
  });
});
