/**
 * Page CDP domain helpers.
 * @param {import('../client.js').CDPClient} client
 * @param {{ screenshot?: boolean }} capabilities
 */
export function createPageDomain(client, capabilities = {}) {
  return {
    async navigate(url, timeout = 30_000) {
      const [result] = await Promise.all([
        client.send('Page.navigate', { url }),
        waitForLoad(client, timeout),
      ]);
      return result;
    },

    async reload(ignoreCache = false) {
      await Promise.all([
        client.send('Page.reload', { ignoreCache }),
        waitForLoad(client),
      ]);
    },

    async screenshot({ format = 'png', quality = 80, fullPage = false } = {}) {
      if (capabilities.screenshot === false) return null;
      const params = { format, quality };
      if (fullPage) {
        const dims = await client.send('Runtime.evaluate', {
          expression: 'JSON.stringify({w: document.body.scrollWidth, h: document.body.scrollHeight})',
          returnByValue: true,
        }).then(({ result }) => JSON.parse(result.value)).catch(() => null);
        if (dims) params.clip = { x: 0, y: 0, width: dims.w, height: dims.h, scale: 1 };
      }
      const { data } = await client.send('Page.captureScreenshot', params);
      return data; // base64
    },

    async getURL() {
      const { result } = await client.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      });
      return result.value;
    },

    async getTitle() {
      const { result } = await client.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      });
      return result.value;
    },

    async goBack() {
      await client.send('Page.goBack');
    },

    async goForward() {
      await client.send('Page.goForward');
    },

    async handleDialog(accept = true, promptText = '') {
      await client.send('Page.handleJavaScriptDialog', { accept, promptText });
    },
  };
}

function waitForLoad(client, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('Page.loadEventFired', onLoad);
      resolve(); // Don't reject — page might be partial
    }, timeout);

    function onLoad() {
      clearTimeout(timer);
      resolve();
    }
    client.once('Page.loadEventFired', onLoad);
  });
}
