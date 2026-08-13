import { resolveReasoner } from '../resolve-provider';
import { MockLLMProvider } from '../../reasoner/providers/mock';

describe('resolveReasoner', () => {
  it('returns agent-template mode for the cursor provider instead of a silent mock', () => {
    const resolved = resolveReasoner({ reasoner: { provider: 'cursor' } });
    expect(resolved.mode).toBe('agent-template');
    expect(resolved.providerName).toBe('cursor');
    expect(resolved).not.toHaveProperty('provider');
  });

  it('returns agent-template mode for provider none', () => {
    expect(resolveReasoner({ reasoner: { provider: 'none' } }).mode).toBe('agent-template');
  });

  it('defaults to agent-template when no reasoner is configured', () => {
    expect(resolveReasoner({}).mode).toBe('agent-template');
  });

  it('returns a live mock provider only when explicitly configured', () => {
    const resolved = resolveReasoner({ reasoner: { provider: 'mock' } });
    expect(resolved.mode).toBe('provider');
    if (resolved.mode !== 'provider') throw new Error('expected provider mode');
    expect(resolved.provider).toBeInstanceOf(MockLLMProvider);
  });

  it('throws a helpful error when anthropic is selected without a key', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => resolveReasoner({ reasoner: { provider: 'anthropic' } })).toThrow(/no API key/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
