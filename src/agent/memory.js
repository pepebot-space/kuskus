/**
 * Rolling short-term memory for agent step history.
 * Keeps the last N steps in full, summarizes older ones if needed.
 */
export class AgentMemory {
  #steps = [];
  #windowSize;

  constructor({ windowSize = 10 } = {}) {
    this.#windowSize = windowSize;
  }

  /**
   * Add a completed step to memory.
   * @param {{ step: number, tool: string, params: object, result: string, error?: string }} entry
   */
  push(entry) {
    this.#steps.push(entry);
    if (this.#steps.length > this.#windowSize) {
      this.#steps.shift();
    }
  }

  /**
   * Return steps formatted as a string for inclusion in the LLM prompt.
   */
  toContextString() {
    if (this.#steps.length === 0) return 'No previous actions.';
    return this.#steps
      .map((s) => {
        const status = s.error ? `ERROR: ${s.error}` : `OK: ${String(s.result).slice(0, 300)}`;
        return `Step ${s.step}: ${s.tool}(${JSON.stringify(s.params)}) → ${status}`;
      })
      .join('\n');
  }

  get length() { return this.#steps.length; }

  clear() { this.#steps = []; }

  getAll() { return [...this.#steps]; }
}
