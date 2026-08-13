import { AnthropicProvider } from '../reasoner/providers/anthropic';
import { MockLLMProvider } from '../reasoner/providers/mock';
import type { ResolvedReasoner } from '../pipeline/reasoner-mode';
import type { DeepCoverConfig } from './config';

export type { ResolvedReasoner };

type ProviderName = NonNullable<DeepCoverConfig['reasoner']>['provider'];

const DEFAULT_PROVIDER: ProviderName = 'cursor';

/**
 * True when `reason` will only write a template and hand off to an external
 * agent. Answers the question without constructing a provider, so callers that
 * merely want to word a hint cannot trip the missing-API-key error.
 */
export function isAgentReasoner(config: DeepCoverConfig): boolean {
  const provider = config.reasoner?.provider ?? DEFAULT_PROVIDER;
  return provider === 'cursor' || provider === 'none';
}

/**
 * Decide who plays the Reasoner for this run, and say so out loud.
 *
 * `cursor`/`none` mean an external agent fills `reasoner-output.json`; the CLI
 * writes a template and stops. Returning a mock provider for those (as earlier
 * versions did) fabricated LLM insight that nobody asked for and nobody could
 * see was fake.
 */
export function resolveReasoner(config: DeepCoverConfig): ResolvedReasoner {
  const provider = config.reasoner?.provider ?? DEFAULT_PROVIDER;

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
