export { extractCodeModel } from './extractor';
export type { ExtractOptions, TsMorphProjectOptions } from './extractor';

export * from './types/code-model';

export { resolveCoverage } from './resolver';
export type { ResolvedCoverage, MethodCoverage } from './resolver';

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
