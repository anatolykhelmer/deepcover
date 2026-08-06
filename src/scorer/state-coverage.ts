import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';

/** Branch scale 0–1 when Istanbul exists on the affected method; otherwise 1. */
function getBranchScaleForState(
  className: string,
  affectedMethods: string[],
  resolvedCoverage: ResolvedCoverage
): number {
  if (!resolvedCoverage.hasIstanbulData) return 1;
  let hasAny = false;
  let best = 0;
  for (const m of affectedMethods) {
    const mc = resolvedCoverage.getMethodCoverage(className, m);
    if (mc?.istanbul) {
      hasAny = true;
      const pct = mc.istanbul.branchCoveragePercent;
      if (pct > best) best = pct;
    }
  }
  return hasAny ? best / 100 : 1;
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
 * State coverage is purely reasoner-driven.
 * Without discoveredStates the metric is not applicable and its weight
 * is redistributed to the other sub-scores.
 *
 * When the reasoner provides states, each tested state scores at its
 * Istanbul branch scale (0-1); untested states score 0.
 * The result is capped at overall Istanbul branch coverage + 10
 * to prevent LLM inflation beyond what Istanbul data supports.
 */
export function calculateStateCoverage(
  _codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  const discovered = reasonerOutput.discoveredStates;

  if (discovered.length === 0) {
    return { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: false };
  }

  let testedWeight = 0;
  let totalConfidence = 0;

  for (const ds of discovered) {
    totalConfidence += ds.confidence;
    if (ds.isTested) {
      const scale = getBranchScaleForState(ds.className, [ds.methodName], resolvedCoverage);
      testedWeight += scale * ds.confidence;
    }
  }

  const avgConfidence = totalConfidence / discovered.length;
  let base = (testedWeight / discovered.length) * 100;

  const overallBranch = getOverallBranchCoverage(resolvedCoverage);
  if (overallBranch !== undefined) {
    base = Math.min(base, overallBranch + 10);
  }

  const final = Math.max(0, Math.min(100, base));
  return { base, llmAdjustment: 0, final, confidence: avgConfidence, applicable: true };
}
