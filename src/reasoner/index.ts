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
import { buildDomainStatesPrompt } from './prompts/domain-states';
import { buildAssertionQualityPrompt } from './prompts/assertion-quality';
import { buildCriticalityPrompt } from './prompts/criticality';
import { buildTransitiveCoveragePrompt } from './prompts/transitive-coverage';
import { buildBugFindingPrompt } from './prompts/bug-finding';

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

export async function runReasoner(
  codeModel: CodeModel,
  provider: LLMProvider,
  bugSignals?: BugSignal[]
): Promise<ReasonerOutput> {
  const classes = codeModel.modules.flatMap((m) => m.classes);
  const standaloneFunctions = codeModel.modules
    .map((m) => ({ filePath: m.filePath, functions: m.functions ?? [] }))
    .filter((entry) => entry.functions.length > 0);
  const { testFiles } = codeModel.testInventory;
  const edges = codeModel.dependencyGraph;

  const domainP = runJob('Domain states', async () => {
    const { system, user } = buildDomainStatesPrompt({ classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => DiscoveredStateSchema.parse(item));
  });

  const assertionP = runJob('Assertion quality', async () => {
    const { system, user } = buildAssertionQualityPrompt({ testFiles, classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => AssertionJudgmentSchema.parse(item));
  });

  const criticalityP = runJob('Criticality', async () => {
    const { system, user } = buildCriticalityPrompt({ classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => CriticalityRatingSchema.parse(item));
  });

  const transitiveP = runJob('Transitive coverage', async () => {
    const { system, user } = buildTransitiveCoveragePrompt({
      edges,
      classes,
      standaloneFunctions,
      testInventory: codeModel.testInventory,
    });
    const raw = await provider.analyze(system, user);
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item) => TransitiveInferenceSchema.parse(item));
  });

  const bugP: Promise<BugFindingOutput | undefined> =
    bugSignals && bugSignals.length > 0
      ? (async () => {
          try {
            const { system, user } = buildBugFindingPrompt({
              classes,
              testFiles,
              bugSignals,
            });
            const raw = await provider.analyze(system, user);
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
