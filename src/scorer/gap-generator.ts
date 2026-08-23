import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { StateCatalog, StateCatalogEntry } from './state-catalog';
import type { PrioritizedGap } from './types';
import { allCallables } from '../types/callable';

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
    for (const c of allCallables(mod)) {
      const mc = resolvedCoverage.getMethodCoverage(c.owner, c.node.name, mod.filePath);
      const hasTests = mc?.isCovered ?? false;
      const risk = getMethodRisk(c.node, reasonerOutput, c.owner, c.node.name);
      const kindWord = c.ownerKind === 'class' ? 'Method' : 'Function';

      if (!hasTests) {
        gaps.push({
          rank: 0,
          className: c.owner,
          methodName: c.node.name,
          scenario: 'has no test coverage',
          risk,
          reason: `${kindWord} ${c.node.name} is untested`,
          suggestedTest: suggestTest(c.owner, c.node.name, 'when called'),
        });
      } else if (mc?.istanbul) {
        const { lineCoveragePercent, branchCoveragePercent } = mc.istanbul;
        if (lineCoveragePercent < 50 || branchCoveragePercent < 50) {
          gaps.push({
            rank: 0,
            className: c.owner,
            methodName: c.node.name,
            scenario: 'partially covered',
            risk,
            reason: `${kindWord} ${c.node.name} has Istanbul line ${lineCoveragePercent}% / branch ${branchCoveragePercent}% (below 50%)`,
            suggestedTest: suggestTest(c.owner, c.node.name, 'to raise line and branch coverage above 50%'),
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
