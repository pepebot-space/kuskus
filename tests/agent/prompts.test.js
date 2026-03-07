import { describe, it, expect } from 'vitest';
import {
  TASK_CONTEXT_TEMPLATE,
  PLANNING_SYSTEM_PROMPT,
  PLANNING_USER_TEMPLATE,
} from '../../src/agent/prompts.js';

describe('TASK_CONTEXT_TEMPLATE', () => {
  it('includes task, step, and maxSteps', () => {
    const out = TASK_CONTEXT_TEMPLATE('search cats', 3, 20, null);
    expect(out).toContain('search cats');
    expect(out).toContain('3/20');
  });

  it('includes plan section when plan is provided', () => {
    const plan = 'Goal: Find cats.\nSteps:\n1. Navigate\n2. Search';
    const out = TASK_CONTEXT_TEMPLATE('search cats', 1, 20, plan);
    expect(out).toContain('Execution Plan');
    expect(out).toContain('Goal: Find cats');
  });

  it('omits plan section when plan is null', () => {
    const out = TASK_CONTEXT_TEMPLATE('search cats', 1, 20, null);
    expect(out).not.toContain('Execution Plan');
  });

  it('omits plan section when plan is undefined', () => {
    const out = TASK_CONTEXT_TEMPLATE('search cats', 1, 20);
    expect(out).not.toContain('Execution Plan');
  });
});

describe('PLANNING_SYSTEM_PROMPT', () => {
  it('mentions Goal, Steps, and Output', () => {
    expect(PLANNING_SYSTEM_PROMPT).toContain('Goal');
    expect(PLANNING_SYSTEM_PROMPT).toContain('Steps');
    expect(PLANNING_SYSTEM_PROMPT).toContain('Output');
  });

  it('mentions login behavior', () => {
    expect(PLANNING_SYSTEM_PROMPT).toContain('log in');
  });
});

describe('PLANNING_USER_TEMPLATE', () => {
  it('includes the task in the output', () => {
    const out = PLANNING_USER_TEMPLATE('buy a laptop on tokopedia');
    expect(out).toContain('buy a laptop on tokopedia');
    expect(out).toContain('execution plan');
  });
});
