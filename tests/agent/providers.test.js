import { describe, it, expect } from 'vitest';
import { detectProvider } from '../../src/agent/providers.js';

describe('detectProvider', () => {
  it('detects anthropic for claude models', () => {
    expect(detectProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(detectProvider('claude-opus-4-6')).toBe('anthropic');
    expect(detectProvider('claude-haiku-4-5-20251001')).toBe('anthropic');
  });

  it('detects openai for gpt models', () => {
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('gpt-4o-mini')).toBe('openai');
    expect(detectProvider('gpt-4-turbo')).toBe('openai');
  });

  it('detects openai for o-series models', () => {
    expect(detectProvider('o1')).toBe('openai');
    expect(detectProvider('o1-mini')).toBe('openai');
    expect(detectProvider('o3-mini')).toBe('openai');
    expect(detectProvider('o4-mini')).toBe('openai');
  });

  it('detects openai for chatgpt models', () => {
    expect(detectProvider('chatgpt-4o-latest')).toBe('openai');
  });

  it('defaults to anthropic for unknown models', () => {
    expect(detectProvider('unknown-model')).toBe('anthropic');
    expect(detectProvider('')).toBe('anthropic');
    expect(detectProvider()).toBe('anthropic');
  });
});
