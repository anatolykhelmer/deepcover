import type { CodeModel, TestNode } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import type { SubScore } from './types';
import { getAssertionWeight } from './matchers';
import { buildClassMethodOwners } from '../types/method-owner';

function extractMethodFromTarget(target: string): string | null {
  const match = target.match(/\.(\w+)\s*\(/);
  return match ? match[1] : null;
}

function qualityToAdjustment(quality: 'weak' | 'medium' | 'strong'): number {
  if (quality === 'weak') return -10;
  if (quality === 'strong') return 10;
  return 0;
}

function collectFailedTestNames(resolvedCoverage: ResolvedCoverage): Set<string> {
  const failed = new Set<string>();
  for (const mc of resolvedCoverage.methods.values()) {
    for (const name of mc.runtime?.failedTests ?? []) {
      failed.add(name);
    }
  }
  return failed;
}

function getRuntimeAssertionCount(
  resolvedCoverage: ResolvedCoverage,
  className: string,
  methodName: string,
  testName: string
): number | undefined {
  const mc = resolvedCoverage.getMethodCoverage(className, methodName);
  const hit = mc?.runtime?.perTest.find((t) => t.name === testName);
  return hit?.assertionCount;
}

export function calculateAssertionQuality(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): SubScore {
  let base = 0;
  const testFiles = codeModel.testInventory.testFiles;

  if (testFiles.length === 0) {
    return { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: true };
  }

  // Class-owned methods are keyed by every class in scope that declares them, so a
  // test can only be credited toward the specific class it resolved to — a same-named
  // method on an unrelated class must not share assertion-quality credit. Standalone
  // functions have no comparable per-test class signal and keep the previous
  // module-wide (unqualified) match.
  const classMethodOwners = buildClassMethodOwners(codeModel.modules);
  const functionOwner = new Map<string, string>();
  for (const mod of codeModel.modules) {
    for (const fn of mod.functions ?? []) {
      functionOwner.set(fn.name, mod.filePath);
    }
  }

  const failedTestNames = collectFailedTestNames(resolvedCoverage);
  const resolverEmpty = resolvedCoverage.methods.size === 0;

  /** Resolves which class/module owns `target`, validating a class-owned method
   *  against the test's own resolved `targetClass` — fails closed (`null`) when
   *  that can't be established. */
  function resolveOwner(
    target: string,
    testTargetClass: string | null | undefined
  ): { owner: string; isClass: boolean } | null {
    const classOwners = classMethodOwners.get(target);
    if (classOwners && classOwners.size > 0) {
      return testTargetClass && classOwners.has(testTargetClass)
        ? { owner: testTargetClass, isClass: true }
        : null;
    }
    const fileOwner = functionOwner.get(target);
    return fileOwner ? { owner: fileOwner, isClass: false } : null;
  }

  function targetMethodCovered(owner: string, targetMethod: string, isClass: boolean): boolean {
    if (resolverEmpty) {
      const key = isClass ? `${owner}.${targetMethod}` : targetMethod;
      return (codeModel.testInventory.coverage[key]?.length ?? 0) > 0;
    }
    return resolvedCoverage.isMethodCovered(owner, targetMethod);
  }

  function shouldCountTest(test: TestNode): boolean {
    const target = test.targetMethod ?? undefined;
    if (failedTestNames.has(test.name)) return false;
    if (!target) return false;
    const resolved = resolveOwner(target, test.targetClass);
    if (!resolved) return false;
    return targetMethodCovered(resolved.owner, target, resolved.isClass);
  }

  let weightedScore = 0;
  let totalAssertions = 0;
  const countedAssertions = new Set<string>();

  for (const file of testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        const target = test.targetMethod ?? undefined;
        if (!target) continue;
        if (failedTestNames.has(test.name)) continue;
        const resolved = resolveOwner(target, test.targetClass);
        if (!resolved) continue;
        if (!targetMethodCovered(resolved.owner, target, resolved.isClass)) continue;

        let assertions = test.assertions;
        const runtimeAc = resolvedCoverage.hasRuntimeData
          ? getRuntimeAssertionCount(resolvedCoverage, resolved.owner, target, test.name)
          : undefined;
        if (runtimeAc !== undefined && runtimeAc !== assertions.length) {
          assertions = assertions.slice(0, Math.min(assertions.length, runtimeAc));
        }
        for (let i = 0; i < assertions.length; i++) {
          const assertion = assertions[i];
          const key = `${test.name}:${i}`;
          if (countedAssertions.has(key)) continue;
          countedAssertions.add(key);
          const w = getAssertionWeight(assertion.matcherUsed);
          weightedScore += w;
          totalAssertions += 1;

          const transitiveMethod = extractMethodFromTarget(assertion.target);
          if (transitiveMethod && transitiveMethod !== target) {
            // Transitive credit is scoped to the same test's own resolved owner —
            // a class-owned transitive method only counts if that same class
            // declares it too, not any class anywhere with a matching name.
            const transOwners = classMethodOwners.get(transitiveMethod);
            const transitiveAllowed =
              transOwners && transOwners.size > 0
                ? resolved.isClass && transOwners.has(resolved.owner)
                : functionOwner.has(transitiveMethod);
            if (transitiveAllowed) {
              const transitiveKey = `${test.name}:${i}:transitive:${transitiveMethod}`;
              if (!countedAssertions.has(transitiveKey)) {
                countedAssertions.add(transitiveKey);
                weightedScore += w;
                totalAssertions += 1;
              }
            }
          }
        }
      }
    }
  }

  const maxPossible = totalAssertions > 0 ? totalAssertions * 3 : 0;
  base = maxPossible > 0 ? (weightedScore / maxPossible) * 100 : 0;

  let llmAdjustment = 0;
  let totalConfidence = 0;
  const judgments = reasonerOutput.assertionJudgments;

  const moduleTestNames = new Set<string>();
  for (const file of testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        if (shouldCountTest(test)) {
          moduleTestNames.add(test.name);
        }
      }
    }
  }

  if (judgments.length > 0) {
    const testNameToJudgment = new Map<string, { quality: 'weak' | 'medium' | 'strong'; confidence: number }>();
    for (const j of judgments) {
      if (!moduleTestNames.has(j.testName)) continue;
      const existing = testNameToJudgment.get(j.testName);
      if (!existing || j.confidence > existing.confidence) {
        testNameToJudgment.set(j.testName, { quality: j.quality, confidence: j.confidence });
      }
    }
    let sumAdjustment = 0;
    for (const [, v] of testNameToJudgment) {
      sumAdjustment += qualityToAdjustment(v.quality) * v.confidence;
      totalConfidence += v.confidence;
    }
    if (testNameToJudgment.size > 0) {
      const avgConfidence = totalConfidence / testNameToJudgment.size;
      llmAdjustment = (sumAdjustment / testNameToJudgment.size) * (avgConfidence / 1);
      llmAdjustment = Math.max(-20, Math.min(20, llmAdjustment));
    }
  }

  const confidence = judgments.length > 0 ? totalConfidence / judgments.length : 0;
  const final = Math.max(0, Math.min(100, base + llmAdjustment));

  return { base, llmAdjustment, final, confidence, applicable: true };
}
