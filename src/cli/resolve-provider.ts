import type { LLMProvider } from '../reasoner/providers/base';
import { AnthropicProvider } from '../reasoner/providers/anthropic';
import { MockLLMProvider } from '../reasoner/providers/mock';
import type { ResolvedReasoner } from '../pipeline/reasoner-mode';
import type { DeepCoverConfig } from './config';

export type { ResolvedReasoner };

/**
 * Decide who plays the Reasoner for this run, and say so out loud.
 *
 * `cursor`/`none` mean an external agent fills `reasoner-output.json`; the CLI
 * writes a template and stops. Returning a mock provider for those (as earlier
 * versions did) fabricated LLM insight that nobody asked for and nobody could
 * see was fake.
 */
export function resolveReasoner(config: DeepCoverConfig): ResolvedReasoner {
  const provider = config.reasoner?.provider ?? 'cursor';

  if (provider === 'anthropic') {
    const apiKey = config.reasoner?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Anthropic provider selected but no API key found. ' +
          'Set reasoner.apiKey in deepcover.config or ANTHROPIC_API_KEY in the environment.',
      );
    }
    return {
      mode: 'provider',
      providerName: 'anthropic',
      provider: new AnthropicProvider({ apiKey, model: config.reasoner?.model }),
    };
  }

  if (provider === 'mock') {
    return { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() };
  }

  return { mode: 'agent-template', providerName: provider };
}

/** @deprecated Use `resolveReasoner` — this cannot express agent-template mode. */
export function resolveLLMProvider(config: DeepCoverConfig): LLMProvider {
  const resolved = resolveReasoner(config);
  return resolved.mode === 'provider' ? resolved.provider : new MockLLMProvider();
}
