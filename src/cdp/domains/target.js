/**
 * Target CDP domain helpers (tab management).
 * These operate on the browser-level client, not a page session.
 * @param {import('../session.js').SessionManager} sessionManager
 */
export function createTargetDomain(sessionManager) {
  return {
    async listTabs() {
      const targets = await sessionManager.listTargets();
      return targets
        .filter((t) => t.type === 'page')
        .map((t) => ({ id: t.id, url: t.url, title: t.title }));
    },

    async newTab(url = 'about:blank') {
      const client = await sessionManager.createTarget(url);
      return client;
    },

    async closeTab(targetId) {
      await sessionManager.closeTarget(targetId);
    },

    async switchTab(targetId) {
      return sessionManager.attachTarget(targetId);
    },
  };
}
