/**
 * Input CDP domain helpers.
 * @param {import('../client.js').CDPClient} client
 */
export function createInputDomain(client) {
  return {
    async click(x, y) {
      // Move → down → up sequence
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },

    async hover(x, y) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },

    async scroll(x, y, deltaX = 0, deltaY = 300) {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX,
        deltaY,
      });
    },

    /**
     * Type a string character by character.
     * @param {string} text
     * @param {number} [delay] ms between keystrokes
     */
    async type(text, delay = 30) {
      for (const char of text) {
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char, unmodifiedText: char });
        if (delay > 0) await sleep(delay);
      }
    },

    /**
     * Press a special key (Enter, Tab, Backspace, Escape, ArrowDown, etc.)
     * @param {string} key  - DOM key name
     */
    async keyPress(key) {
      const keyCode = KEY_CODES[key] ?? 0;
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const KEY_CODES = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Escape: 27,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Space: 32,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  F1: 112, F2: 113, F3: 114, F4: 115,
  F5: 116, F6: 117, F7: 118, F8: 119,
};
