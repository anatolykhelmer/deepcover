export { extractCodeModel } from './extractor';
export type { ExtractOptions, TsMorphProjectOptions } from './extractor';

export * from './types/code-model';

export { resolveCoverage } from './resolver';
export type { ResolvedCoverage, MethodCoverage } from './resolver';

// Coverage identity helpers. `ResolvedCoverage`'s accessors require a declaring
// file; callers holding only a class name resolve it through these first.
export {
  buildClassFileOwners,
  buildClassMethodOwners,
  classMethodKey,
  resolveClassMethodKey,
  resolveReasonerOwnerFile,
  resolveTestClassFile,
} from './types/method-owner';
export type { ClassFileOwners, ClassMethodOwners } from './types/method-owner';

export { runScorer } from './scorer';
export type { ScorerOptions } from './scorer';
export type { ScoreResult, ScoreWeights } from './scorer';
export type { SubScore, FunctionScore, PrioritizedGap } from './scorer';

export { runReasoner } from './reasoner';
export { scopeModelForReasoner } from './reasoner/scope';
export type { ReasonerScope } from './reasoner/scope';
export type { LLMProvider } from './reasoner/providers/base';

export { DeepCoverReporter } from './reporter/jest-reporter';
export type { DeepCoverRuntimeData } from './reporter/jest-reporter';

export { runBugDetector } from './bug-detector';
export type { BugSignal } from './bug-detector';

export { mergeBugFindings } from './bug-merger';
export type { PotentialBug } from './bug-merger';

export {
  runExtractStage,
  runReasonStage,
  runAnalyzeStage,
  runPipeline,
  resolvePaths,
  buildPrompts,
} from './pipeline';
export type {
  ExtractStageOptions,
  ExtractStageResult,
  ReasonStageOptions,
  ReasonStageResult,
  AnalyzeStageOptions,
  AnalyzeStageResult,
  RunPipelineOptions,
  RunPipelineResult,
  PromptSet,
  PromptPair,
} from './pipeline';

// Reachability closure of the exports above: a consumer that writes its own
// wrapper around any of them has to be able to name these in its signatures.
export type { ResolvedReasoner, ResolvedPaths, BuildPromptsInput, PromptContext } from './pipeline';
export type { ReasonerOutput } from './reasoner/types';
export type { MethodCoverageInfo } from './reasoner/prompts/criticality';
export type { JestRuntimeData } from './resolver/types';
