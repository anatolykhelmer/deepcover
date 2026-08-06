import type { CodeModel } from '../types/code-model';
import type { LLMProvider } from './providers/base';
import type { ReasonerOutput } from './types';
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

  const discoveredStates: ReasonerOutput['discoveredStates'] = [];
  const assertionJudgments: ReasonerOutput['assertionJudgments'] = [];
  const criticalityRatings: ReasonerOutput['criticalityRatings'] = [];
  const transitiveInferences: ReasonerOutput['transitiveInferences'] = [];

  // 1. Domain states
  try {
    const { system, user } = buildDomainStatesPrompt({ classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const json = extractJsonFromResponse(raw);
    const parsed = JSON.parse(json) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    const validated = arr.map((item) => DiscoveredStateSchema.parse(item));
    discoveredStates.push(...validated);
  } catch (err) {
    console.warn('[runReasoner] Domain states validation failed:', err);
  }

  // 2. Assertion quality
  try {
    const { system, user } = buildAssertionQualityPrompt({ testFiles, classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const json = extractJsonFromResponse(raw);
    const parsed = JSON.parse(json) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    const validated = arr.map((item) => AssertionJudgmentSchema.parse(item));
    assertionJudgments.push(...validated);
  } catch (err) {
    console.warn('[runReasoner] Assertion quality validation failed:', err);
  }

  // 3. Criticality
  try {
    const { system, user } = buildCriticalityPrompt({ classes, standaloneFunctions });
    const raw = await provider.analyze(system, user);
    const json = extractJsonFromResponse(raw);
    const parsed = JSON.parse(json) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    const validated = arr.map((item) => CriticalityRatingSchema.parse(item));
    criticalityRatings.push(...validated);
  } catch (err) {
    console.warn('[runReasoner] Criticality validation failed:', err);
  }

  // 4. Transitive coverage
  try {
    const { system, user } = buildTransitiveCoveragePrompt({
      edges,
      classes,
      standaloneFunctions,
      testInventory: codeModel.testInventory,
    });
    const raw = await provider.analyze(system, user);
    const json = extractJsonFromResponse(raw);
    const parsed = JSON.parse(json) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    const validated = arr.map((item) => TransitiveInferenceSchema.parse(item));
    transitiveInferences.push(...validated);
  } catch (err) {
    console.warn('[runReasoner] Transitive coverage validation failed:', err);
  }

  // 5. Bug finding (optional)
  let bugFindings: ReasonerOutput['bugFindings'] = undefined;
  if (bugSignals && bugSignals.length > 0) {
    try {
      const { system, user } = buildBugFindingPrompt({
        classes,
        testFiles,
        bugSignals,
      });
      const raw = await provider.analyze(system, user);
      const trimmed = raw.trim();
      const start = trimmed.indexOf('{');
      if (start !== -1) {
        let depth = 0;
        let end = start;
        for (let i = start; i < trimmed.length; i++) {
          if (trimmed[i] === '{') depth++;
          else if (trimmed[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        const json = trimmed.slice(start, end + 1);
        bugFindings = BugFindingOutputSchema.parse(JSON.parse(json));
      }
    } catch (err) {
      console.warn('[runReasoner] Bug finding validation failed:', err);
    }
  }

  const output: ReasonerOutput = {
    discoveredStates,
    assertionJudgments,
    criticalityRatings,
    transitiveInferences,
    ...(bugFindings && { bugFindings }),
  };

  return ReasonerOutputSchema.parse(output);
}
