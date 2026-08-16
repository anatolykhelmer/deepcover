import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { PrioritizedGap } from './types';

const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;

function getMethodRisk(
  method: { branchCount: number; externalCalls: string[] },
  reasonerOutput: ReasonerOutput,
  className: string,
  methodName: string
): 'low' | 'medium' | 'high' {
  const rating = reasonerOutput.criticalityRatings.find(
    (r) => r.className === className && r.methodName === methodName
  );
  if (rating) return rating.criticality;
  const complexity = method.branchCount + method.externalCalls.length;
  if (complexity >= 5) return 'high';
  if (complexity >= 2) return 'medium';
  return 'low';
}

function suggestTest(className: string, methodName: string, scenario: string): string {
  return `Test ${className}.${methodName} ${scenario}`;
}

export function generateGaps(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): PrioritizedGap[] {
  const gaps: PrioritizedGap[] = [];

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        const mc = resolvedCoverage.getMethodCoverage(cls.name, method.name, mod.filePath);
        const hasTests = mc?.isCovered ?? false;
        const risk = getMethodRisk(method, reasonerOutput, cls.name, method.name);

        if (!hasTests) {
          gaps.push({
            rank: 0,
            className: cls.name,
            methodName: method.name,
            scenario: 'has no test coverage',
            risk,
            reason: `Method ${method.name} is untested`,
            suggestedTest: suggestTest(cls.name, method.name, 'when called'),
          });
        } else if (mc?.istanbul) {
          const { lineCoveragePercent, branchCoveragePercent } = mc.istanbul;
          if (lineCoveragePercent < 50 || branchCoveragePercent < 50) {
            gaps.push({
              rank: 0,
              className: cls.name,
              methodName: method.name,
              scenario: 'partially covered',
              risk,
              reason: `Method ${method.name} has Istanbul line ${lineCoveragePercent}% / branch ${branchCoveragePercent}% (below 50%)`,
              suggestedTest: suggestTest(cls.name, method.name, 'to raise line and branch coverage above 50%'),
            });
          }
        }
      }

      for (const state of cls.states) {
        const covered = state.affectedMethods.some((m) => resolvedCoverage.isMethodCovered(cls.name, m, mod.filePath));
        if (!covered) {
          const risk = state.affectedMethods.some((m) => {
            const method = cls.methods.find((mm) => mm.name === m);
            return method && getMethodRisk(method, reasonerOutput, cls.name, m) === 'high';
          })
            ? 'high'
            : 'medium';
          gaps.push({
            rank: 0,
            className: cls.name,
            methodName: state.affectedMethods[0] ?? 'unknown',
            scenario: `state "${state.name}" (${state.values.join(', ')})`,
            risk,
            reason: `State ${state.name} affects ${state.affectedMethods.join(', ')} but is untested`,
            suggestedTest: suggestTest(cls.name, state.affectedMethods[0] ?? 'unknown', `when ${state.name} is ${state.values[0] ?? 'active'}`),
          });
        }
      }
    }

    for (const fn of mod.functions ?? []) {
      const className = mod.filePath;
      const mc = resolvedCoverage.getMethodCoverage(className, fn.name, mod.filePath);
      const hasTests = mc?.isCovered ?? false;
      const risk = getMethodRisk(fn, reasonerOutput, className, fn.name);

      if (!hasTests) {
        gaps.push({
          rank: 0,
          className,
          methodName: fn.name,
          scenario: 'has no test coverage',
          risk,
          reason: `Function ${fn.name} is untested`,
          suggestedTest: suggestTest(className, fn.name, 'when called'),
        });
      } else if (mc?.istanbul) {
        const { lineCoveragePercent, branchCoveragePercent } = mc.istanbul;
        if (lineCoveragePercent < 50 || branchCoveragePercent < 50) {
          gaps.push({
            rank: 0,
            className,
            methodName: fn.name,
            scenario: 'partially covered',
            risk,
            reason: `Function ${fn.name} has Istanbul line ${lineCoveragePercent}% / branch ${branchCoveragePercent}% (below 50%)`,
            suggestedTest: suggestTest(className, fn.name, 'to raise line and branch coverage above 50%'),
          });
        }
      }
    }
  }

  for (const ds of reasonerOutput.discoveredStates) {
    if (!ds.isTested && ds.riskIfUntested !== 'low') {
      const exists = gaps.some(
        (g) => g.className === ds.className && g.methodName === ds.methodName && g.scenario.includes(ds.state)
      );
      if (!exists) {
        gaps.push({
          rank: 0,
          className: ds.className,
          methodName: ds.methodName,
          scenario: ds.state,
          risk: ds.riskIfUntested,
          reason: `LLM-discovered state "${ds.state}" is untested`,
          suggestedTest: suggestTest(ds.className, ds.methodName, ds.state),
        });
      }
    }
  }

  gaps.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
  gaps.forEach((g, i) => {
    g.rank = i + 1;
  });

  return gaps;
}
