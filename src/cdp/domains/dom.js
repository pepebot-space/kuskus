/**
 * DOM CDP domain helpers.
 * @param {import('../client.js').CDPClient} client
 */
export function createDOMDomain(client) {
  return {
    async getDocument() {
      const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
      return root;
    },

    async getOuterHTML(nodeId) {
      const { outerHTML } = await client.send('DOM.getOuterHTML', { nodeId });
      return outerHTML;
    },

    /**
     * Find a single node by CSS selector. Returns nodeId or null.
     * @param {string} selector
     * @param {number} [contextNodeId]  search root (defaults to document)
     */
    async querySelector(selector, contextNodeId) {
      const root = contextNodeId ?? (await this.getDocument()).nodeId;
      const { nodeId } = await client.send('DOM.querySelector', { nodeId: root, selector });
      return nodeId || null;
    },

    /**
     * Find all nodes matching CSS selector. Returns nodeId[].
     */
    async querySelectorAll(selector, contextNodeId) {
      const root = contextNodeId ?? (await this.getDocument()).nodeId;
      const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root, selector });
      return nodeIds;
    },

    async getBoxModel(nodeId) {
      const { model } = await client.send('DOM.getBoxModel', { nodeId });
      return model;
    },

    /**
     * Returns { x, y } center of element bounding box.
     */
    async getCenter(nodeId) {
      const box = await this.getBoxModel(nodeId);
      const content = box.content; // [x0,y0, x1,y1, x2,y2, x3,y3]
      const x = (content[0] + content[2]) / 2;
      const y = (content[1] + content[5]) / 2;
      return { x, y };
    },

    async scrollIntoView(nodeId) {
      await client.send('DOM.scrollIntoViewIfNeeded', { nodeId });
    },

    async focus(nodeId) {
      await client.send('DOM.focus', { nodeId });
    },

    async setAttribute(nodeId, name, value) {
      await client.send('DOM.setAttributeValue', { nodeId, name, value });
    },

    /**
     * Describe a node (tag, attributes, children count).
     */
    async describeNode(nodeId) {
      const { node } = await client.send('DOM.describeNode', { nodeId });
      return node;
    },

    /**
     * Get resolved attributes for a node as a flat object.
     */
    async getAttributes(nodeId) {
      const { attributes } = await client.send('DOM.getAttributes', { nodeId });
      const obj = {};
      for (let i = 0; i < attributes.length; i += 2) {
        obj[attributes[i]] = attributes[i + 1];
      }
      return obj;
    },
  };
}
