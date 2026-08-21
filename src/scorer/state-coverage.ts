import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';
import type { StateCatalog } from './state-catalog';

/** Branch scale 0–1 when Istanbul exists on the state's method; otherwise 1.
 *  `owner` is a class name or, for standalone-function-owned catalog entries,
 *  the module filePath (BL-001). */
function getBranchScaleForState(
  owner: string,
  filePath: string,
  methodName: string,
  resolvedCoverage: ResolvedCoverage
): number {
  if (!resolvedCoverage.hasIstanbulData) return 1;
  const mc = resolvedCoverage.getMethodCoverage(owner, methodName, filePath);
  return mc?.istanbul ? mc.istanbul.branchCoveragePercent / 100 : 1;
}

/** Aggregate Istanbul branch coverage across all methods. Returns 0–100 or undefined if no data. */
function getOverallBranchCoverage(resolvedCoverage: ResolvedCoverage): number | undefined {
  if (!resolvedCoverage.hasIstanbulData) return undefined;
  let totalBranches = 0;
  let hitBranches = 0;
  for (const mc of resolvedCoverage.methods.values()) {
    if (mc.istanbul) {
      totalBranches += mc.istanbul.branchesTotal;
      hitBranches += mc.istanbul.branchesHit;
    }
  }
  return totalBranches > 0 ? (hitBranches / totalBranches) * 100 : undefined;
}

/**
 * State coverage over the unified StateCatalog (static ∪ reasoner states,
 * testedness decided at catalog build — see state-catalog.ts). With no
 * entries the metric is not applicable and its weight is redistributed to
 * the other sub-scores.
 *
 * Each tested entry scores at its Istanbul branch scale (0-1) weighted by
 * the entry's confidence; untested entries score 0. The result is capped at
 * overall Istanbul branch coverage + 10 to prevent LLM inflation beyond
 * what Istanbul data supports.
 */
export function calculateStateCoverage(
  catalog: StateCatalog,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  const { entries } = catalog;
  if (entries.length === 0) {
    return { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: false };
  }

  let testedWeight = 0;
  let totalConfidence = 0;

  for (const e of entries) {
    totalConfidence += e.confidence;
    if (e.isTested) {
      const scale = getBranchScaleForState(e.owner, e.filePath, e.methodName, resolvedCoverage);
      testedWeight += scale * e.confidence;
    }
  }

  const avgConfidence = totalConfidence / entries.length;
  let base = (testedWeight / entries.length) * 100;

  const overallBranch = getOverallBranchCoverage(resolvedCoverage);
  if (overallBranch !== undefined) {
    base = Math.min(base, overallBranch + 10);
  }

  const final = Math.max(0, Math.min(100, base));
  return { base, llmAdjustment: 0, final, confidence: avgConfidence, applicable: true };
}
