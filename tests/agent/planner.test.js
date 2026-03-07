import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Planner } from '../../src/agent/planner.js';

// Mock providers module
vi.mock('../../src/agent/providers.js', () => ({
  detectProvider: vi.fn(() => 'anthropic'),
  createProvider: vi.fn(() => ({
    provider: 'anthropic',
    call: vi.fn(),
    textCall: vi.fn(),
    buildImageBlock: vi.fn((b64) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    })),
  })),
}));

import { createProvider } from '../../src/agent/providers.js';

describe('Planner.plan()', () => {
  let planner;
  let mockProvider;

  beforeEach(() => {
    planner = new Planner({ model: 'claude-sonnet-4-6' });
    mockProvider = createProvider.mock.results[createProvider.mock.results.length - 1].value;
  });

  it('returns a plan string from textCall', async () => {
    const expectedPlan = 'Goal: Search Google.\nSteps:\n1. Navigate to google.com\n2. Type query\nOutput: Search results';
    mockProvider.textCall.mockResolvedValueOnce(expectedPlan);

    const plan = await planner.plan('search google for cats');
    expect(plan).toBe(expectedPlan);
    expect(mockProvider.textCall).toHaveBeenCalledOnce();
  });

  it('passes PLANNING_SYSTEM_PROMPT and user task to textCall', async () => {
    mockProvider.textCall.mockResolvedValueOnce('some plan');

    await planner.plan('go to tokopedia and find laptops');

    const { systemPrompt, userText } = mockProvider.textCall.mock.calls[0][0];
    expect(systemPrompt).toContain('Goal');
    expect(systemPrompt).toContain('Steps');
    expect(systemPrompt).toContain('Output');
    expect(userText).toContain('go to tokopedia and find laptops');
  });

  it('returns null and does not throw if textCall fails', async () => {
    mockProvider.textCall.mockRejectedValueOnce(new Error('API error'));

    const plan = await planner.plan('some task');
    expect(plan).toBeNull();
  });
});

describe('Planner.nextAction()', () => {
  let planner;
  let mockProvider;

  beforeEach(() => {
    planner = new Planner({ model: 'claude-sonnet-4-6', includeScreenshot: false });
    mockProvider = createProvider.mock.results[createProvider.mock.results.length - 1].value;
  });

  it('includes plan in context text when provided', async () => {
    mockProvider.call.mockResolvedValueOnce({ toolName: 'navigate', params: { url: 'https://google.com' } });

    await planner.nextAction({
      task: 'search for cats',
      step: 1,
      maxSteps: 20,
      history: '',
      screenshot: null,
      pageContent: '',
      currentUrl: 'about:blank',
      plan: 'Goal: Search cats.\nSteps:\n1. Navigate to google.com',
    });

    const userContent = mockProvider.call.mock.calls[0][0].userContent;
    const text = userContent.find((b) => b.type === 'text').text;
    expect(text).toContain('Execution Plan');
    expect(text).toContain('Search cats');
  });

  it('works without a plan (plan is null)', async () => {
    mockProvider.call.mockResolvedValueOnce({ toolName: 'finish', params: { result: 'done' } });

    await expect(
      planner.nextAction({
        task: 'some task',
        step: 1,
        maxSteps: 20,
        history: '',
        screenshot: null,
        pageContent: '',
        currentUrl: 'about:blank',
        plan: null,
      })
    ).resolves.toEqual({ toolName: 'finish', params: { result: 'done' } });

    const userContent = mockProvider.call.mock.calls[0][0].userContent;
    const text = userContent.find((b) => b.type === 'text').text;
    expect(text).not.toContain('Execution Plan');
  });

  it('returns toolName and params from provider', async () => {
    mockProvider.call.mockResolvedValueOnce({ toolName: 'click', params: { selector: '#btn' } });

    const result = await planner.nextAction({
      task: 'click a button',
      step: 2,
      maxSteps: 20,
      history: '',
      screenshot: null,
      pageContent: '',
      currentUrl: 'https://example.com',
      plan: null,
    });

    expect(result).toEqual({ toolName: 'click', params: { selector: '#btn' } });
  });
});
