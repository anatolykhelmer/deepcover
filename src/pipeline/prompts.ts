import type { CodeModel, TestInventory } from '../types/code-model';
import type { BugSignal } from '../bug-detector/types';
import type { JestRuntimeData } from '../resolver/types';
import { buildDomainStatesPrompt } from '../reasoner/prompts/domain-states';
import { buildAssertionQualityPrompt } from '../reasoner/prompts/assertion-quality';
import { buildCriticalityPrompt, type MethodCoverageInfo } from '../reasoner/prompts/criticality';
import { buildTransitiveCoveragePrompt } from '../reasoner/prompts/transitive-coverage';
import { buildBugFindingPrompt } from '../reasoner/prompts/bug-finding';

export interface PromptPair {
  system: string;
  user: string;
}

export interface PromptSet {
  domainStates: PromptPair;
  assertionQuality: PromptPair;
  criticality: PromptPair;
  transitiveCoverage: PromptPair;
  bugFinding?: PromptPair;
}

/** Extra material the prompts use when it is available on disk. */
export interface PromptContext {
  istanbulCoverage?: Map<string, MethodCoverageInfo>;
  runtime?: JestRuntimeData;
}

export interface BuildPromptsInput extends PromptContext {
  /** Must already be narrowed with `scopeModelForReasoner`. */
  scopedModel: CodeModel;
  bugSignals?: BugSignal[];
}

/**
 * Map each target method to the names of the tests that exercise it.
 *
 * Runtime names are folded in when a Jest run is available, because `test.each`
 * and template names only exist at runtime. Runtime-only tests that match no
 * statically-known name are left out: nothing here can attribute them to a
 * method, and the full runtime data reaches the scorer by another path.
 */
export function buildTestsByMethod(
  testInventory: TestInventory,
  runtime?: JestRuntimeData,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const file of testInventory.testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        if (!test.targetMethod) continue;
        if (!result[test.targetMethod]) result[test.targetMethod] = [];
        result[test.targetMethod]!.push(test.name);
      }
    }
  }

  if (runtime?.testResults) {
    const runtimeNames = new Set(runtime.testResults.map((t) => t.testName));
    for (const method of Object.keys(result)) {
      const existing = new Set(result[method]);
      for (const name of runtimeNames) {
        if (!existing.has(name) && result[method]!.some((s) => name.includes(s))) {
          result[method]!.push(name);
        }
      }
    }
  }

  return result;
}

/**
 * The single source of Reasoner prompts. `extract` serializes the result into
 * `prompts.json` for an agent; `runReasoner` sends the same pairs to a provider.
 * Both therefore reason over identical material.
 */
export function buildPrompts(input: BuildPromptsInput): PromptSet {
  const { scopedModel, istanbulCoverage, runtime, bugSignals } = input;

  const classes = scopedModel.modules.flatMap((m) => m.classes);
  const standaloneFunctions = scopedModel.modules
    .map((m) => ({ filePath: m.filePath, functions: m.functions ?? [] }))
    .filter((entry) => entry.functions.length > 0);
  const testFiles = scopedModel.testInventory.testFiles;
  const testsByMethod = buildTestsByMethod(scopedModel.testInventory, runtime);

  const prompts: PromptSet = {
    domainStates: buildDomainStatesPrompt({ classes, testsByMethod, standaloneFunctions }),
    assertionQuality: buildAssertionQualityPrompt({ testFiles, classes, standaloneFunctions }),
    criticality: buildCriticalityPrompt({
      classes,
      dependencyGraph: scopedModel.dependencyGraph,
      ...(istanbulCoverage && { istanbulCoverage }),
      standaloneFunctions,
    }),
    transitiveCoverage: buildTransitiveCoveragePrompt({
      edges: scopedModel.dependencyGraph,
      classes,
      standaloneFunctions,
      testInventory: scopedModel.testInventory,
    }),
  };

  if (bugSignals) {
    prompts.bugFinding = buildBugFindingPrompt({ classes, testFiles, bugSignals });
  }

  return prompts;
}
