import type { LLMProvider } from '../reasoner/providers/base';

/**
 * Who plays the Reasoner for this run. Declared here rather than in the CLI so
 * that stages can depend on it without the pipeline importing the CLI layer.
 */
export type ResolvedReasoner =
  | { mode: 'provider'; providerName: 'anthropic' | 'mock'; provider: LLMProvider }
  | { mode: 'agent-template'; providerName: 'cursor' | 'none' };
