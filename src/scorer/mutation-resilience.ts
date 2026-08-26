import type { CodeModel, TestFileNode } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';
import { getAssertionSpecificity } from './matchers';
import { buildClassFileOwners, type ClassFileOwners } from '../types/method-owner';
import { allCallables } from '../types/callable';
import { allTests, testInScopeOf, type TestScope } from '../types/test-inventory';

function extractMethodFromTarget(target: string): string | null {
  const match = target.match(/\.(\w+)\s*\(/);
  return match ? match[1] : null;
}

/**
 * Tallies assertion specificity for one method — a direct match (test named the
 * method as its target) or a text match (some assertion literally calls it).
 *
 * The text-match path scans every test in the inventory. To prevent a same-named
 * method on an unrelated class — or the same class name declared in another file —
 * from inflating this method's specificity score (task 021), scoping is enforced
 * via `testInScopeOf`, which admits all tests for standalone functions but gates
 * class methods to those with resolved ownership.
 */
function tallyAssertionSpecificity(
  testFiles: TestFileNode[],
  methodName: string,
  scope: TestScope,
  classFileOwners: ClassFileOwners
): { specificitySum: number; count: number } {
  let specificitySum = 0;
  let count = 0;

  for (const test of allTests(testFiles)) {
    if (!testInScopeOf(test, scope, classFileOwners)) continue;

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

  return { specificitySum, count };
}

export function calculateMutationResilience(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage,
  maxAdjustment: number = 20
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
    for (const c of allCallables(mod)) {
      const mc = resolvedCoverage.getMethodCoverage(c.owner, c.node.name, mod.filePath);
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
        const branchCount = c.node.branchCount;
        if (branchCount > 0) {
          totalBranches += branchCount;
          if (hasTests) branchesHitWeighted += branchCount;
        } else if (hasTests) {
          totalBranches += 1;
          branchesHitWeighted += 1;
        }
      }

      if (hasTests) {
        const { specificitySum, count } = tallyAssertionSpecificity(
          testFiles, c.node.name, c, classFileOwners);
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
      llmAdjustment = Math.min(maxAdjustment, confirmed.length * 2);
      totalConfidence /= confirmed.length;
    }
  }

  const confidence = inferences.length > 0 ? totalConfidence : 0;
  const final = Math.max(0, Math.min(100, base + llmAdjustment));

  return { base, llmAdjustment, final, confidence, applicable: true };
}
