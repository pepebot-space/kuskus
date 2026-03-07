import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../src/agent/tools.js';

describe('TOOL_DEFINITIONS', () => {
  it('has required fields on every tool', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
      expect(tool.input_schema).toHaveProperty('type', 'object');
    }
  });

  it('includes a finish tool', () => {
    const finish = TOOL_DEFINITIONS.find((t) => t.name === 'finish');
    expect(finish).toBeDefined();
    expect(finish.input_schema.required).toContain('result');
  });

  it('navigate tool requires url', () => {
    const nav = TOOL_DEFINITIONS.find((t) => t.name === 'navigate');
    expect(nav.input_schema.required).toContain('url');
  });
});
