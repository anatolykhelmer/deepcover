import type { CodeModel, TestFileNode } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';
import { getAssertionSpecificity } from './matchers';
import { buildClassFileOwners, resolveTestClassFile, type ClassFileOwners } from '../types/method-owner';

function extractMethodFromTarget(target: string): string | null {
  const match = target.match(/\.(\w+)\s*\(/);
  return match ? match[1] : null;
}

/**
 * Tallies assertion specificity for one method — a direct match (test named the
 * method as its target) or a text match (some assertion literally calls it).
 *
 * For class methods (`isClass: true`) every test considered must have a resolved
 * `targetClass` equal to `owner` AND resolve to this module's own file first:
 * the text-match path in particular scans every test in the inventory, and
 * without this gate a same-named method on an unrelated class — or the same
 * class name declared in another file — would inflate this method's specificity
 * score (task 021). Standalone functions have no comparable per-test class
 * signal and keep the previous unscoped match.
 */
function tallyAssertionSpecificity(
  testFiles: TestFileNode[],
  methodName: string,
  owner: string,
  isClass: boolean,
  filePath: string,
  classFileOwners: ClassFileOwners
): { specificitySum: number; count: number } {
  let specificitySum = 0;
  let count = 0;

  for (const file of testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        if (isClass && test.targetClass !== owner) continue;
        if (
          isClass &&
          resolveTestClassFile(test.targetClass, test.targetClassFile ?? null, classFileOwners) !== filePath
        ) continue;

        if (test.targetMethod === methodName) {
          for (const a of test.assertions) {
            specificitySum += getAssertionSpecificity(a.matcherUsed);
            count += 1;
          }
          continue;
        }

        for (const a of test.assertions) {
          if (extractMethodFromTarget(a.target) === methodName) {
            specificitySum += getAssertionSpecificity(a.matcherUsed);
            count += 1;
          }
        }
      }
    }
  }

  return { specificitySum, count };
}

export function calculateMutationResilience(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  const testFiles = codeModel.testInventory.testFiles;

  if (testFiles.length === 0) {
    return { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: true };
  }

  let totalBranches = 0;
  let branchesHitWeighted = 0;
  let assertionSpecificitySum = 0;
  let assertionCount = 0;
  const classFileOwners = buildClassFileOwners(codeModel.modules);

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        const mc = resolvedCoverage.getMethodCoverage(cls.name, method.name, mod.filePath);
        const hasTests = mc?.isCovered ?? false;

        if (resolvedCoverage.hasIstanbulData && mc?.istanbul) {
          const { branchesTotal, branchesHit } = mc.istanbul;
          if (branchesTotal > 0) {
            totalBranches += branchesTotal;
            if (hasTests) branchesHitWeighted += branchesHit;
          } else if (hasTests) {
            totalBranches += 1;
            branchesHitWeighted += 1;
          }
        } else {
          const branchCount = method.branchCount;
          if (branchCount > 0) {
            totalBranches += branchCount;
            if (hasTests) branchesHitWeighted += branchCount;
          } else if (hasTests) {
            totalBranches += 1;
            branchesHitWeighted += 1;
          }
        }

        if (hasTests) {
          const { specificitySum, count } = tallyAssertionSpecificity(testFiles, method.name, cls.name, true, mod.filePath, classFileOwners);
          assertionSpecificitySum += specificitySum;
          assertionCount += count;
        }
      }
    }

    for (const fn of mod.functions ?? []) {
      const mc = resolvedCoverage.getMethodCoverage(mod.filePath, fn.name, mod.filePath);
      const hasTests = mc?.isCovered ?? false;

      if (resolvedCoverage.hasIstanbulData && mc?.istanbul) {
        const { branchesTotal, branchesHit } = mc.istanbul;
        if (branchesTotal > 0) {
          totalBranches += branchesTotal;
          if (hasTests) branchesHitWeighted += branchesHit;
        } else if (hasTests) {
          totalBranches += 1;
          branchesHitWeighted += 1;
        }
      } else {
        const branchCount = fn.branchCount;
        if (branchCount > 0) {
          totalBranches += branchCount;
          if (hasTests) branchesHitWeighted += branchCount;
        } else if (hasTests) {
          totalBranches += 1;
          branchesHitWeighted += 1;
        }
      }

      if (hasTests) {
        const { specificitySum, count } = tallyAssertionSpecificity(testFiles, fn.name, mod.filePath, false, mod.filePath, classFileOwners);
        assertionSpecificitySum += specificitySum;
        assertionCount += count;
      }
    }
  }

  const branchFactor = totalBranches > 0 ? branchesHitWeighted / totalBranches : 0;
  const specificityFactor = assertionCount > 0 ? assertionSpecificitySum / assertionCount : 0;
  const base = ((branchFactor + specificityFactor) / 2) * 100;

  let llmAdjustment = 0;
  let totalConfidence = 0;
  const inferences = reasonerOutput.transitiveInferences;

  if (inferences.length > 0) {
    const confirmed = inferences.filter((t) => t.coveredTransitively);
    for (const inf of confirmed) {
      totalConfidence += inf.confidence;
    }
    if (confirmed.length > 0) {
      llmAdjustment = Math.min(20, confirmed.length * 2);
      totalConfidence /= confirmed.length;
    }
  }

  const confidence = inferences.length > 0 ? totalConfidence : 0;
  const final = Math.max(0, Math.min(100, base + llmAdjustment));

  return { base, llmAdjustment, final, confidence, applicable: true };
}
