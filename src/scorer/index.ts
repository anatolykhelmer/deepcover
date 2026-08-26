import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ScoreResult } from './types';
import type { ScoreWeights } from './composer';
import type { ResolvedCoverage } from '../resolver/types';
import type { PotentialBug } from '../bug-merger/types';
import { runBugDetector } from '../bug-detector';
import { mergeBugFindings } from '../bug-merger';
import { calculateAssertionQuality } from './assertion-quality';
import { calculateStateCoverage } from './state-coverage';
import { buildStateCatalog } from './state-catalog';
import { calculateMutationResilience } from './mutation-resilience';
import { calculateCriticalityWeighting } from './criticality';
import { composeScore } from './composer';

export { runScorer };
export type { ScoreResult };
export type { ScoreWeights } from './composer';
export * from './types';

export interface ScorerOptions {
  weights?: ScoreWeights;
  enableBugs?: boolean;
  /**
   * Fraction (0-1) capping how far the reasoner may move a sub-score.
   * Converted to points here, the single place the two units meet.
   * Does not govern state coverage — that is bounded by Istanbul branch
   * coverage instead (see `state-coverage.ts`).
   */
  maxInfluence?: number;
}

function runScorer(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage,
  options?: ScorerOptions | ScoreWeights,
): ScoreResult {
  // Legacy 4th argument is ScoreWeights (has assertionQuality on the object itself).
  // ScorerOptions uses a wrapper: { weights?, enableBugs? } — never has top-level assertionQuality.
  const opts: ScorerOptions =
    options == null
      ? {}
      : 'assertionQuality' in options
        ? { weights: options as ScoreWeights }
        : (options as ScorerOptions);

  const maxAdjustment = (opts.maxInfluence ?? 0.2) * 100;

  const assertionQuality = calculateAssertionQuality(codeModel, reasonerOutput, resolvedCoverage, maxAdjustment);
  const catalog = buildStateCatalog(codeModel, reasonerOutput, resolvedCoverage);
  if (catalog.droppedAmbiguous > 0) {
    console.warn(
      `deepcover: dropped ${catalog.droppedAmbiguous} reasoner state(s) whose class is declared in multiple files`
    );
  }
  const stateCoverage = calculateStateCoverage(catalog, resolvedCoverage);
  const mutationResilience = calculateMutationResilience(codeModel, reasonerOutput, resolvedCoverage, maxAdjustment);
  const criticalityWeighting = calculateCriticalityWeighting(codeModel, reasonerOutput, resolvedCoverage, maxAdjustment);

  const subScores = { assertionQuality, stateCoverage, mutationResilience, criticalityWeighting };
  const scoreResult = composeScore(subScores, codeModel, reasonerOutput, resolvedCoverage, catalog, opts.weights);

  let potentialBugs: PotentialBug[] = [];
  if (opts.enableBugs) {
    const signals = runBugDetector(codeModel, resolvedCoverage);
    const llmFindings = reasonerOutput.bugFindings?.findings ?? [];
    const validations = reasonerOutput.bugFindings?.signalValidations ?? [];
    potentialBugs = mergeBugFindings(signals, llmFindings, validations);
  }

  return { ...scoreResult, potentialBugs };
}
