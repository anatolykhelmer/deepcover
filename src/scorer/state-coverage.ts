import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';
import { buildClassFileOwners, resolveReasonerOwnerFile } from '../types/method-owner';

/** Branch scale 0–1 when Istanbul exists on the affected method; otherwise 1. */
function getBranchScaleForState(
  className: string,
  filePath: string,
  affectedMethods: string[],
  resolvedCoverage: ResolvedCoverage
): number {
  if (!resolvedCoverage.hasIstanbulData) return 1;
  let hasAny = false;
  let best = 0;
  for (const m of affectedMethods) {
    const mc = resolvedCoverage.getMethodCoverage(className, m, filePath);
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
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  const classFileOwners = buildClassFileOwners(codeModel.modules);

  // A state naming a class that several files declare cannot be tied to either
  // declaration. Scoring it anyway would read the missing lookup as "no Istanbul
  // data" and hand it full branch scale, so it is dropped from the metric.
  const discovered = reasonerOutput.discoveredStates
    .map((ds) => ({ ds, filePath: resolveReasonerOwnerFile(ds.className, classFileOwners) }))
    .filter((entry): entry is { ds: typeof entry.ds; filePath: string } => entry.filePath !== null);

  if (discovered.length === 0) {
    return { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: false };
  }

  let testedWeight = 0;
  let totalConfidence = 0;

  for (const { ds, filePath } of discovered) {
    totalConfidence += ds.confidence;
    if (ds.isTested) {
      const scale = getBranchScaleForState(ds.className, filePath, [ds.methodName], resolvedCoverage);
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
