import { describe, it, expect } from 'vitest';
import { AgentMemory } from '../../src/agent/memory.js';

describe('AgentMemory', () => {
  it('stores and trims to window size', () => {
    const mem = new AgentMemory({ windowSize: 3 });
    for (let i = 1; i <= 5; i++) {
      mem.push({ step: i, tool: 'navigate', params: {}, result: 'ok' });
    }
    expect(mem.length).toBe(3);
    // Oldest entries should be removed
    const entries = mem.getAll();
    expect(entries[0].step).toBe(3);
    expect(entries[2].step).toBe(5);
  });

  it('returns readable context string', () => {
    const mem = new AgentMemory();
    mem.push({ step: 1, tool: 'navigate', params: { url: 'http://x.com' }, result: 'Navigated' });
    const ctx = mem.toContextString();
    expect(ctx).toContain('Step 1');
    expect(ctx).toContain('navigate');
    expect(ctx).toContain('Navigated');
  });

  it('shows no previous actions when empty', () => {
    const mem = new AgentMemory();
    expect(mem.toContextString()).toBe('No previous actions.');
  });

  it('clears correctly', () => {
    const mem = new AgentMemory();
    mem.push({ step: 1, tool: 'click', params: {}, result: 'ok' });
    mem.clear();
    expect(mem.length).toBe(0);
  });
});
