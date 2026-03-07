/**
 * Network CDP domain helpers.
 * @param {import('../client.js').CDPClient} client
 */
export function createNetworkDomain(client) {
  const requests = new Map();

  client.on('Network.requestWillBeSent', (params) => {
    requests.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      timestamp: params.timestamp,
    });
  });

  client.on('Network.responseReceived', (params) => {
    const req = requests.get(params.requestId);
    if (req) {
      req.status = params.response.status;
      req.responseHeaders = params.response.headers;
      req.mimeType = params.response.mimeType;
    }
  });

  return {
    async enable() {
      await client.send('Network.enable');
    },

    async disable() {
      await client.send('Network.disable');
    },

    /**
     * Enable request interception for matching URL patterns.
     * @param {string[]} patterns  e.g. ['*']
     */
    async enableInterception(patterns = ['*']) {
      await client.send('Fetch.enable', {
        patterns: patterns.map((urlPattern) => ({ urlPattern })),
      });
    },

    async disableInterception() {
      await client.send('Fetch.disable');
    },

    async continueRequest(requestId, options = {}) {
      await client.send('Fetch.continueRequest', { requestId, ...options });
    },

    async fulfillRequest(requestId, responseCode, body, responseHeaders = []) {
      await client.send('Fetch.fulfillRequest', {
        requestId,
        responseCode,
        body: Buffer.from(body).toString('base64'),
        responseHeaders,
      });
    },

    async getResponseBody(requestId) {
      const { body, base64Encoded } = await client.send('Network.getResponseBody', { requestId });
      return base64Encoded ? Buffer.from(body, 'base64').toString() : body;
    },

    getRequests() {
      return Array.from(requests.values());
    },

    clearRequests() {
      requests.clear();
    },
  };
}
