import type { CodeModel } from '../types/code-model';
import type { LLMProvider } from './providers/base';
import type { ReasonerOutput, BugFindingOutput } from './types';
import {
  ReasonerOutputSchema,
  DiscoveredStateSchema,
  AssertionJudgmentSchema,
  CriticalityRatingSchema,
  TransitiveInferenceSchema,
  BugFindingOutputSchema,
} from './types';
import type { BugSignal } from '../bug-detector/types';
import { scopeModelForReasoner, type ReasonerScope } from './scope';
import { buildPrompts, type PromptContext } from '../pipeline/prompts';

function extractJsonFromResponse(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('[');
  if (start === -1) return '[]';
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return '[]';
}

function extractJsonObjectFromResponse(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

async function runJob<T>(
  label: string,
  run: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await run();
  } catch (err) {
    console.warn(`[runReasoner] ${label} validation failed:`, err);
    return [];
  }
}

/**
 * `scope` is not optional in spirit: the extractor's test inventory is always
 * repository-wide, so scoping happens here rather than at each call site — a
 * caller that forgets it gets the fail-closed default instead of the whole
 * repository's tests in every prompt.
 */
export async function runReasoner(
  codeModel: CodeModel,
  provider: LLMProvider,
  bugSignals?: BugSignal[],
  scope: ReasonerScope = {},
  promptContext: PromptContext = {},
): Promise<ReasonerOutput> {
  const scopedModel = scopeModelForReasoner(codeModel, scope);
  const prompts = buildPrompts({ scopedModel, ...promptContext, ...(bugSignals && { bugSignals }) });

  const domainP = runJob('Domain states', async () => {
    const raw = await provider.analyze(prompts.domainStates.system, prompts.domainStates.user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => DiscoveredStateSchema.parse(item));
  });

  const assertionP = runJob('Assertion quality', async () => {
    const raw = await provider.analyze(prompts.assertionQuality.system, prompts.assertionQuality.user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => AssertionJudgmentSchema.parse(item));
  });

  const criticalityP = runJob('Criticality', async () => {
    const raw = await provider.analyze(prompts.criticality.system, prompts.criticality.user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => CriticalityRatingSchema.parse(item));
  });

  const transitiveP = runJob('Transitive coverage', async () => {
    const raw = await provider.analyze(prompts.transitiveCoverage.system, prompts.transitiveCoverage.user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => TransitiveInferenceSchema.parse(item));
  });

  const bugP: Promise<BugFindingOutput | undefined> = prompts.bugFinding
    ? (async () => {
        try {
          const raw = await provider.analyze(prompts.bugFinding!.system, prompts.bugFinding!.user);
          const json = extractJsonObjectFromResponse(raw);
          if (!json) return undefined;
          return BugFindingOutputSchema.parse(JSON.parse(json));
        } catch (err) {
          console.warn('[runReasoner] Bug finding validation failed:', err);
          return undefined;
        }
      })()
    : Promise.resolve(undefined);

  const [discoveredStates, assertionJudgments, criticalityRatings, transitiveInferences, bugFindings] =
    await Promise.all([domainP, assertionP, criticalityP, transitiveP, bugP]);

  const output: ReasonerOutput = {
    discoveredStates,
    assertionJudgments,
    criticalityRatings,
    transitiveInferences,
    ...(bugFindings && { bugFindings }),
  };

  return ReasonerOutputSchema.parse(output);
}
