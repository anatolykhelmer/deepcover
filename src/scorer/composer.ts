import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { ScoreResult, SubScore, FunctionScore } from './types';
import { generateGaps } from './gap-generator';

const STRONG_MATCHERS = ['toEqual', 'toHaveBeenCalledWith', 'toThrow', 'toStrictEqual', 'toBe'];
const WEAK_MATCHERS = ['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeNull'];

function extractMethodFromTarget(target: string): string | null {
  const match = target.match(/\.(\w+)\s*\(/);
  return match ? match[1] : null;
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
  weights: ScoreWeights = DEFAULT_WEIGHTS
): ScoreResult {
  const w = redistributeWeights(subScores, weights);
  const composite =
    subScores.assertionQuality.final * w.assertionQuality +
    subScores.stateCoverage.final * w.stateCoverage +
    subScores.mutationResilience.final * w.mutationResilience +
    subScores.criticalityWeighting.final * w.criticalityWeighting;

  const perFunction: FunctionScore[] = [];

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      const statesForClass = cls.states;
      for (const method of cls.methods) {
        const mc = resolvedCoverage.getMethodCoverage(cls.name, method.name);
        const testNames = resolvedCoverage.getTestsForMethod(cls.name, method.name);

        const methodStates = statesForClass.filter((s) => s.affectedMethods.includes(method.name));
        const testedStates = methodStates.filter((s) =>
          s.affectedMethods.some((m) => resolvedCoverage.isMethodCovered(cls.name, m))
        ).length;
        const totalStates = methodStates.length;

        let strongAssertions = 0;
        let weakAssertions = 0;
        let transitiveStrong = 0;
        let transitiveWeak = 0;
        for (const file of codeModel.testInventory.testFiles) {
          for (const block of file.describes) {
            for (const test of block.tests) {
              const directMatch = test.targetMethod === method.name && testNames.includes(test.name);
              const transitiveMatch = !directMatch && test.targetMethod !== method.name && testNames.includes(test.name);
              if (directMatch) {
                for (const a of test.assertions) {
                  if (STRONG_MATCHERS.includes(a.matcherUsed)) strongAssertions += 1;
                  else if (WEAK_MATCHERS.includes(a.matcherUsed)) weakAssertions += 1;
                }
              } else if (transitiveMatch) {
                for (const a of test.assertions) {
                  if (STRONG_MATCHERS.includes(a.matcherUsed)) transitiveStrong += 1;
                  else if (WEAK_MATCHERS.includes(a.matcherUsed)) transitiveWeak += 1;
                }
              } else {
                for (const a of test.assertions) {
                  if (extractMethodFromTarget(a.target) === method.name) {
                    if (STRONG_MATCHERS.includes(a.matcherUsed)) strongAssertions += 1;
                    else if (WEAK_MATCHERS.includes(a.matcherUsed)) weakAssertions += 1;
                  }
                }
              }
            }
          }
        }
        const TRANSITIVE_DISCOUNT = 0.5;
        strongAssertions += Math.round(transitiveStrong * TRANSITIVE_DISCOUNT);
        weakAssertions += Math.round(transitiveWeak * TRANSITIVE_DISCOUNT);

        const untested: string[] = [];
        if (!mc?.isCovered) {
          untested.push('no test coverage');
        }
        for (const ds of reasonerOutput.discoveredStates) {
          if (ds.className === cls.name && ds.methodName === method.name && !ds.isTested) {
            untested.push(ds.state);
          }
        }

        const istanbulBase = mc?.istanbul?.lineCoveragePercent
          ? (mc.istanbul.lineCoveragePercent / 100) * 30
          : (mc?.isCovered ? 15 : 0);
        const stateScore = totalStates > 0
          ? (testedStates / totalStates) * 35
          : 0;
        const assertionScore = Math.min(35, strongAssertions * 10 + weakAssertions * 2);
        const methodComposite = istanbulBase + stateScore + assertionScore;

        const lineCoveragePercent = mc?.istanbul?.lineCoveragePercent;
        const branchCoveragePercent = mc?.istanbul?.branchCoveragePercent;

        perFunction.push({
          className: cls.name,
          methodName: method.name,
          composite: Math.min(100, methodComposite),
          criticality: getCriticality(method, reasonerOutput, cls.name, method.name),
          testedStates,
          totalStates,
          strongAssertions,
          weakAssertions,
          untested,
          ...(lineCoveragePercent !== undefined ? { lineCoveragePercent } : {}),
          ...(branchCoveragePercent !== undefined ? { branchCoveragePercent } : {}),
          coverageSource: mc?.coverageSource,
        });
      }
    }

    for (const fn of mod.functions ?? []) {
      const className = mod.filePath;
      const mc = resolvedCoverage.getMethodCoverage(className, fn.name);
      const testNames = resolvedCoverage.getTestsForMethod(className, fn.name);
      const testedStates = 0;
      const totalStates = 0;

      let strongAssertions = 0;
      let weakAssertions = 0;
      let transitiveStrong = 0;
      let transitiveWeak = 0;
      for (const file of codeModel.testInventory.testFiles) {
        for (const block of file.describes) {
          for (const test of block.tests) {
            const directMatch = test.targetMethod === fn.name && testNames.includes(test.name);
            const transitiveMatch = !directMatch && test.targetMethod !== fn.name && testNames.includes(test.name);
            if (directMatch) {
              for (const a of test.assertions) {
                if (STRONG_MATCHERS.includes(a.matcherUsed)) strongAssertions += 1;
                else if (WEAK_MATCHERS.includes(a.matcherUsed)) weakAssertions += 1;
              }
            } else if (transitiveMatch) {
              for (const a of test.assertions) {
                if (STRONG_MATCHERS.includes(a.matcherUsed)) transitiveStrong += 1;
                else if (WEAK_MATCHERS.includes(a.matcherUsed)) transitiveWeak += 1;
              }
            } else {
              for (const a of test.assertions) {
                if (extractMethodFromTarget(a.target) === fn.name) {
                  if (STRONG_MATCHERS.includes(a.matcherUsed)) strongAssertions += 1;
                  else if (WEAK_MATCHERS.includes(a.matcherUsed)) weakAssertions += 1;
                }
              }
            }
          }
        }
      }
      const TRANSITIVE_DISCOUNT = 0.5;
      strongAssertions += Math.round(transitiveStrong * TRANSITIVE_DISCOUNT);
      weakAssertions += Math.round(transitiveWeak * TRANSITIVE_DISCOUNT);

      const untested: string[] = [];
      if (!mc?.isCovered) {
        untested.push('no test coverage');
      }
      for (const ds of reasonerOutput.discoveredStates) {
        if (ds.className === className && ds.methodName === fn.name && !ds.isTested) {
          untested.push(ds.state);
        }
      }

      const istanbulBase = mc?.istanbul?.lineCoveragePercent
        ? (mc.istanbul.lineCoveragePercent / 100) * 30
        : (mc?.isCovered ? 15 : 0);
      const stateScore = 0;
      const assertionScore = Math.min(35, strongAssertions * 10 + weakAssertions * 2);
      const methodComposite = istanbulBase + stateScore + assertionScore;

      const lineCoveragePercent = mc?.istanbul?.lineCoveragePercent;
      const branchCoveragePercent = mc?.istanbul?.branchCoveragePercent;

      perFunction.push({
        className,
        methodName: fn.name,
        composite: Math.min(100, methodComposite),
        criticality: getCriticality(fn, reasonerOutput, className, fn.name),
        testedStates,
        totalStates,
        strongAssertions,
        weakAssertions,
        untested,
        ...(lineCoveragePercent !== undefined ? { lineCoveragePercent } : {}),
        ...(branchCoveragePercent !== undefined ? { branchCoveragePercent } : {}),
        coverageSource: mc?.coverageSource,
      });
    }
  }

  const gaps = generateGaps(codeModel, reasonerOutput, resolvedCoverage);

  return {
    composite,
    subScores,
    perFunction,
    gaps,
    potentialBugs: [],
  };
}
