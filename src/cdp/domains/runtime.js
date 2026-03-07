/**
 * Runtime CDP domain helpers.
 * @param {import('../client.js').CDPClient} client
 */
export function createRuntimeDomain(client) {
  return {
    /**
     * Evaluate a JS expression in the page context.
     * @param {string} expression
     * @param {boolean} [returnByValue] - serialize result to JSON
     * @returns {Promise<any>}
     */
    async evaluate(expression, returnByValue = true) {
      const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise: true,
        userGesture: true,
      });

      if (exceptionDetails) {
        const msg = exceptionDetails.exception?.description || exceptionDetails.text;
        throw new Error(`JS evaluation error: ${msg}`);
      }

      if (result.type === 'undefined') return undefined;
      if (returnByValue) return result.value;
      return result; // RemoteObject
    },

    /**
     * Call a function on a remote object.
     * @param {string} functionDeclaration
     * @param {string} objectId
     * @param {any[]} args
     */
    async callFunctionOn(functionDeclaration, objectId, args = []) {
      const { result, exceptionDetails } = await client.send('Runtime.callFunctionOn', {
        functionDeclaration,
        objectId,
        arguments: args.map((v) => ({ value: v })),
        returnByValue: true,
        awaitPromise: true,
      });

      if (exceptionDetails) {
        const msg = exceptionDetails.exception?.description || exceptionDetails.text;
        throw new Error(`callFunctionOn error: ${msg}`);
      }

      return result.value;
    },

    /**
     * Get enumerable properties of a remote object.
     * @param {string} objectId
     */
    async getProperties(objectId) {
      const { result } = await client.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
      });
      return result;
    },
  };
}
