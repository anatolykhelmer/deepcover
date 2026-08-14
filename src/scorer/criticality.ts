import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';

function getComplexityWeight(method: { branchCount: number; externalCalls: string[] }): number {
  const branchWeight = Math.min(method.branchCount + 1, 10);
  const externalWeight = Math.min(method.externalCalls.length + 1, 5);
  return branchWeight * externalWeight;
}

function getCriticalityFromLLM(
  reasonerOutput: ReasonerOutput,
  className: string,
  methodName: string
): 'low' | 'medium' | 'high' | null {
  const rating = reasonerOutput.criticalityRatings.find(
    (r) => r.className === className && r.methodName === methodName
  );
  return rating?.criticality ?? null;
}

export function calculateCriticalityWeighting(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  let totalWeight = 0;
  let coveredWeight = 0;

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        const weight = getComplexityWeight(method);
        const llmCriticality = getCriticalityFromLLM(reasonerOutput, cls.name, method.name);
        const effectiveWeight = llmCriticality
          ? weight * (llmCriticality === 'high' ? 2 : llmCriticality === 'medium' ? 1.5 : 1)
          : weight;

        totalWeight += effectiveWeight;
        const mc = resolvedCoverage.getMethodCoverage(cls.name, method.name, mod.filePath);
        const hasTests = mc?.isCovered ?? false;
        if (hasTests) {
          const linePct = mc?.istanbul?.lineCoveragePercent;
          const coverageFraction =
            linePct !== undefined && mc?.coverageSource === 'istanbul' ? linePct / 100 : 1;
          coveredWeight += effectiveWeight * coverageFraction;
        }
      }
    }

    for (const fn of mod.functions ?? []) {
      const weight = getComplexityWeight(fn);
      const llmCriticality = getCriticalityFromLLM(reasonerOutput, mod.filePath, fn.name);
      const effectiveWeight = llmCriticality
        ? weight * (llmCriticality === 'high' ? 2 : llmCriticality === 'medium' ? 1.5 : 1)
        : weight;

      totalWeight += effectiveWeight;
      const mc = resolvedCoverage.getMethodCoverage(mod.filePath, fn.name);
      const hasTests = mc?.isCovered ?? false;
      if (hasTests) {
        const linePct = mc?.istanbul?.lineCoveragePercent;
        const coverageFraction =
          linePct !== undefined && mc?.coverageSource === 'istanbul' ? linePct / 100 : 1;
        coveredWeight += effectiveWeight * coverageFraction;
      }
    }
  }

  const base = totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 0;

  let llmAdjustment = 0;
  let totalConfidence = 0;
  const ratings = reasonerOutput.criticalityRatings;

  if (ratings.length > 0) {
    for (const r of ratings) {
      totalConfidence += r.confidence;
      const hasTests = resolvedCoverage.getMethodCoverage(r.className, r.methodName)?.isCovered ?? false;
      if (r.criticality === 'high' && !hasTests) {
        llmAdjustment -= 10 * r.confidence;
      } else if (r.criticality === 'low' && hasTests) {
        llmAdjustment += 2 * r.confidence;
      }
    }
    llmAdjustment = ratings.length > 0 ? llmAdjustment / ratings.length : 0;
    llmAdjustment = Math.max(-20, Math.min(20, llmAdjustment));
  }

  const confidence = ratings.length > 0 ? totalConfidence / ratings.length : 0;
  const final = Math.max(0, Math.min(100, base + llmAdjustment));

  return { base, llmAdjustment, final, confidence, applicable: true };
}
