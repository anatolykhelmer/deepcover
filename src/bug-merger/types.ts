import type { BugPattern } from '../bug-detector/types';

export type LLMBugPattern = 'untested-invariant' | 'mock-hiding-behavior' | 'unchecked-side-effect';

export interface LLMBugFinding {
  pattern: LLMBugPattern;
  className: string;
  methodName: string;
  description: string;
  risk: 'high' | 'medium' | 'low';
  suggestedTest: string;
}

export interface SignalValidation {
  signalIndex: number;
  confirmed: boolean;
  reasoning: string;
}

export interface PotentialBug {
  id: string;
  rank: number;
  className: string;
  methodName: string;
  pattern: BugPattern | LLMBugPattern;
  risk: 'high' | 'medium' | 'low';
  description: string;
  evidence: string;
  suggestedTest: string;
  source: 'deterministic' | 'llm' | 'hybrid';
}
