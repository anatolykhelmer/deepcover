import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { StateCatalog } from './state-catalog';
import type { ScoreResult, SubScore, FunctionScore } from './types';
import { generateGaps } from './gap-generator';
import { classifyMatcher } from './matchers';
import { buildClassFileOwners, resolveTestClassFile, type ClassFileOwners } from '../types/method-owner';

function extractMethodFromTarget(target: string): string | null {
  const match = target.match(/\.(\w+)\s*\(/);
  return match ? match[1] : null;
}

/** Assertion tally for one method, split by matcher strength. */
interface AssertionTally {
  strong: number;
  medium: number;
  weak: number;
}

function emptyTally(): AssertionTally {
  return { strong: 0, medium: 0, weak: 0 };
}

function tallyAssertion(tally: AssertionTally, matcherUsed: string): void {
  const strength = classifyMatcher(matcherUsed);
  if (strength === 'strong') tally.strong += 1;
  else if (strength === 'medium') tally.medium += 1;
  else if (strength === 'weak') tally.weak += 1;
}

/**
 * Count the assertions that bear on one method, direct and transitive.
 *
 * A test counts as direct when it names the method as its target, or when one
 * of its assertions is written against a call to it. Assertions from tests that
 * merely happen to execute the method count at half weight.
 *
 * The "written against a call to it" path text-scans every assertion in the
 * whole test inventory, so for a class method it must additionally require the
 * test's resolved `targetClass` to match `owner` AND resolve to this module's
 * own file — otherwise a same-named method on an unrelated class, or the same
 * class name in another file, gets full-weight credit here just because some
 * other test happens to call `.methodName(...)`. Standalone functions
 * (`isClass: false`) have no comparable per-test class signal and keep the
 * previous unscoped match.
 */
function tallyAssertionsForMethod(
  codeModel: CodeModel,
  methodName: string,
  testNames: string[],
  owner: string,
  isClass: boolean,
  filePath: string,
  classFileOwners: ClassFileOwners
): AssertionTally {
  const direct = emptyTally();
  const transitive = emptyTally();

  const testTargetsThisClass = (test: { targetClass?: string | null; targetClassFile?: string | null }): boolean =>
    test.targetClass === owner &&
    resolveTestClassFile(test.targetClass, test.targetClassFile ?? null, classFileOwners) === filePath;

  for (const file of codeModel.testInventory.testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        // `testNames` is already file-scoped, but test NAMES are global — two
        // specs may both use it('creates'), so looking a test node back up by
        // name must still require it to target this class's own file.
        const inScope = !isClass || testTargetsThisClass(test);
        const directMatch = inScope && test.targetMethod === methodName && testNames.includes(test.name);
        const transitiveMatch =
          !directMatch && inScope && test.targetMethod !== methodName && testNames.includes(test.name);
        if (directMatch) {
          for (const a of test.assertions) tallyAssertion(direct, a.matcherUsed);
        } else if (transitiveMatch) {
          for (const a of test.assertions) tallyAssertion(transitive, a.matcherUsed);
        } else if (inScope) {
          for (const a of test.assertions) {
            if (extractMethodFromTarget(a.target) === methodName) {
              tallyAssertion(direct, a.matcherUsed);
            }
          }
        }
      }
    }
  }

  const TRANSITIVE_DISCOUNT = 0.5;
  return {
    strong: direct.strong + Math.round(transitive.strong * TRANSITIVE_DISCOUNT),
    medium: direct.medium + Math.round(transitive.medium * TRANSITIVE_DISCOUNT),
    weak: direct.weak + Math.round(transitive.weak * TRANSITIVE_DISCOUNT),
  };
}

/** Per-method assertion points, capped at the 35-point share of the composite. */
const STRONG_POINTS = 10;
const MEDIUM_POINTS = 5;
const WEAK_POINTS = 2;
const MAX_ASSERTION_POINTS = 35;
const MAX_STATE_POINTS = 35;
const MAX_ISTANBUL_POINTS = 30;

function assertionScore(tally: AssertionTally): number {
  return Math.min(
    MAX_ASSERTION_POINTS,
    tally.strong * STRONG_POINTS + tally.medium * MEDIUM_POINTS + tally.weak * WEAK_POINTS
  );
}

export interface ScoreWeights {
  assertionQuality: number;
  stateCoverage: number;
  mutationResilience: number;
  criticalityWeighting: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  assertionQuality: 0.3,
  stateCoverage: 0.3,
  mutationResilience: 0.25,
  criticalityWeighting: 0.15,
};

function getCriticality(
  method: { branchCount: number; externalCalls: string[] },
  reasonerOutput: ReasonerOutput,
  className: string,
  methodName: string
): 'low' | 'medium' | 'high' {
  const rating = reasonerOutput.criticalityRatings.find(
    (r) => r.className === className && r.methodName === methodName
  );
  if (rating) return rating.criticality;
  const c = method.branchCount + method.externalCalls.length;
  if (c >= 5) return 'high';
  if (c >= 2) return 'medium';
  return 'low';
}

function redistributeWeights(
  subScores: {
    assertionQuality: SubScore;
    stateCoverage: SubScore;
    mutationResilience: SubScore;
    criticalityWeighting: SubScore;
  },
  weights: ScoreWeights
): ScoreWeights {
  const entries: [keyof ScoreWeights, SubScore][] = [
    ['assertionQuality', subScores.assertionQuality],
    ['stateCoverage', subScores.stateCoverage],
    ['mutationResilience', subScores.mutationResilience],
    ['criticalityWeighting', subScores.criticalityWeighting],
  ];

  let surplus = 0;
  let applicableTotal = 0;
  for (const [key, sub] of entries) {
    if (!sub.applicable) {
      surplus += weights[key];
    } else {
      applicableTotal += weights[key];
    }
  }

  if (surplus === 0 || applicableTotal === 0) return weights;

  const result = { ...weights };
  for (const [key, sub] of entries) {
    if (!sub.applicable) {
      result[key] = 0;
    } else {
      result[key] = weights[key] + surplus * (weights[key] / applicableTotal);
    }
  }
  return result;
}

export function composeScore(
  subScores: {
    assertionQuality: SubScore;
    stateCoverage: SubScore;
    mutationResilience: SubScore;
    criticalityWeighting: SubScore;
  },
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage,
  catalog: StateCatalog,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): ScoreResult {
  const w = redistributeWeights(subScores, weights);
  const classFileOwners = buildClassFileOwners(codeModel.modules);
  const composite =
    subScores.assertionQuality.final * w.assertionQuality +
    subScores.stateCoverage.final * w.stateCoverage +
    subScores.mutationResilience.final * w.mutationResilience +
    subScores.criticalityWeighting.final * w.criticalityWeighting;

  const perFunction: FunctionScore[] = [];

  /**
   * Score one callable. Class methods key on the class name; standalone
   * functions key on the module file path, matching how the resolver, the
   * reasoner prompts and the gap generator identify them. `filePath` pins
   * the coverage lookup to this module's own declaration, so a same-named
   * class in another file never blocks or steals credit (task 021).
   *
   * Domain states come from the StateCatalog, keyed the same way — testedness
   * was decided per-entry at catalog build time, so a static state counts as
   * tested only when this method itself is covered.
   */
  function scoreCallable(
    owner: string,
    callable: { name: string; branchCount: number; externalCalls: string[] },
    isClass: boolean,
    filePath: string
  ): FunctionScore {
    const mc = resolvedCoverage.getMethodCoverage(owner, callable.name, filePath);
    const testNames = resolvedCoverage.getTestsForMethod(owner, callable.name, filePath);

    const methodEntries = catalog.forMethod(owner, callable.name, filePath);
    const totalStates = methodEntries.length;
    const testedStates = methodEntries.filter((e) => e.isTested).length;

    const tally = tallyAssertionsForMethod(codeModel, callable.name, testNames, owner, isClass, filePath, classFileOwners);

    const untested: string[] = [];
    if (!mc?.isCovered) {
      untested.push('no test coverage');
    }
    for (const e of methodEntries) {
      if (!e.isTested) untested.push(e.stateName);
    }

    const istanbulBase = mc?.istanbul?.lineCoveragePercent
      ? (mc.istanbul.lineCoveragePercent / 100) * MAX_ISTANBUL_POINTS
      : (mc?.isCovered ? MAX_ISTANBUL_POINTS / 2 : 0);
    const stateScore = totalStates > 0 ? (testedStates / totalStates) * MAX_STATE_POINTS : 0;
    const methodComposite = istanbulBase + stateScore + assertionScore(tally);

    const lineCoveragePercent = mc?.istanbul?.lineCoveragePercent;
    const branchCoveragePercent = mc?.istanbul?.branchCoveragePercent;

    return {
      className: owner,
      methodName: callable.name,
      filePath,
      composite: Math.min(100, methodComposite),
      criticality: getCriticality(callable, reasonerOutput, owner, callable.name),
      testedStates,
      totalStates,
      strongAssertions: tally.strong,
      mediumAssertions: tally.medium,
      weakAssertions: tally.weak,
      untested,
      ...(lineCoveragePercent !== undefined ? { lineCoveragePercent } : {}),
      ...(branchCoveragePercent !== undefined ? { branchCoveragePercent } : {}),
      coverageSource: mc?.coverageSource,
    };
  }

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        perFunction.push(scoreCallable(cls.name, method, true, mod.filePath));
      }
    }
    for (const fn of mod.functions ?? []) {
      perFunction.push(scoreCallable(mod.filePath, fn, false, mod.filePath));
    }
  }

  const gaps = generateGaps(codeModel, reasonerOutput, resolvedCoverage, catalog);

  return {
    composite,
    subScores,
    perFunction,
    gaps,
    potentialBugs: [],
  };
}
