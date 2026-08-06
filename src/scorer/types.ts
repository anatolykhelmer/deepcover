import type { PotentialBug } from '../bug-merger/types';

export interface SubScore {
  base: number;           // 0-100, from static analysis alone
  llmAdjustment: number;  // -20 to +20, from reasoner insights
  final: number;          // base + llmAdjustment, clamped 0-100
  confidence: number;     // average confidence of LLM insights used
  applicable: boolean;    // false when the metric doesn't apply (e.g. no states → state coverage N/A)
}

export interface FunctionScore {
  className: string;
  methodName: string;
  composite: number;
  criticality: 'low' | 'medium' | 'high';
  testedStates: number;
  totalStates: number;
  strongAssertions: number;
  weakAssertions: number;
  untested: string[];
  lineCoveragePercent?: number;
  branchCoveragePercent?: number;
  coverageSource?: 'istanbul' | 'static';
}

export interface PrioritizedGap {
  rank: number;
  className: string;
  methodName: string;
  scenario: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  suggestedTest: string;
}

export interface ScoreResult {
  composite: number;        // 0-100
  subScores: {
    assertionQuality: SubScore;
    stateCoverage: SubScore;
    mutationResilience: SubScore;
    criticalityWeighting: SubScore;
  };
  perFunction: FunctionScore[];
  gaps: PrioritizedGap[];
  potentialBugs: PotentialBug[];
}

export type { PotentialBug } from '../bug-merger/types';
