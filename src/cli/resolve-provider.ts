import type { LLMProvider } from '../reasoner/providers/base';
import { AnthropicProvider } from '../reasoner/providers/anthropic';
import { MockLLMProvider } from '../reasoner/providers/mock';
import type { DeepCoverConfig } from './config';

/**
 * Resolve an LLM provider from config + env.
 * Default path is Cursor (external reasoner-input) or mock for --llm without Anthropic.
 */
export function resolveLLMProvider(config: DeepCoverConfig): LLMProvider {
  const provider = config.reasoner?.provider ?? 'cursor';

  if (provider === 'anthropic') {
    const apiKey = config.reasoner?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Anthropic provider selected but no API key found. ' +
          'Set reasoner.apiKey in deepcover.config or ANTHROPIC_API_KEY in the environment.',
      );
    }
    return new AnthropicProvider({
      apiKey,
      model: config.reasoner?.model,
    });
  }

  if (provider === 'mock') {
    return new MockLLMProvider();
  }

  // cursor / none — callers should prefer --reasoner-input or --no-llm
  return new MockLLMProvider();
}
