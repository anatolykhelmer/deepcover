import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { StateCatalog, StateCatalogEntry } from './state-catalog';
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
  resolvedCoverage: ResolvedCoverage,
  catalog: StateCatalog
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

  const methodNodeFor = (e: StateCatalogEntry): { branchCount: number; externalCalls: string[] } | null => {
    const mod = codeModel.modules.find((m) => m.filePath === e.filePath);
    if (!mod) return null;
    const cls = mod.classes.find((c) => c.name === e.owner);
    const callable = cls
      ? cls.methods.find((m) => m.name === e.methodName)
      : (mod.functions ?? []).find((f) => f.name === e.methodName);
    return callable ?? null;
  };

  for (const e of catalog.entries) {
    if (e.isTested) continue;
    let risk = e.riskIfUntested;
    if (!risk) {
      const m = methodNodeFor(e);
      risk = m ? getMethodRisk(m, reasonerOutput, e.owner, e.methodName) : 'medium';
    }
    if (risk === 'low') continue;
    gaps.push({
      rank: 0,
      className: e.owner,
      methodName: e.methodName,
      scenario: e.stateName,
      risk,
      reason:
        e.provenance === 'static'
          ? `State ${e.stateName} in ${e.methodName} is untested`
          : e.provenance === 'reasoner'
            ? `LLM-discovered state "${e.stateName}" is untested`
            : `State "${e.stateName}" is untested (found statically and by the LLM)`,
      suggestedTest: suggestTest(e.owner, e.methodName, e.stateName),
    });
  }

  gaps.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
  gaps.forEach((g, i) => {
    g.rank = i + 1;
  });

  return gaps;
}
