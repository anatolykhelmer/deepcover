import path from 'path';
import type { JestRuntimeData } from './types';
import type { TestFileNode } from '../types/code-model';
import { resolveClassMethodKey, type ClassMethodOwners } from '../types/method-owner';

export interface MethodRuntimeResult {
  passed: string[];
  failed: string[];
  skipped: string[];
  perTest: { name: string; status: 'passed' | 'failed' | 'skipped'; assertionCount: number }[];
}

/**
 * @param classMethodOwners Class-owned method names in scope, from `buildClassMethodOwners`.
 *   Runtime results for a class-owned method are only keyed once the test's resolved
 *   `targetClass` validates against a real owner (fail closed otherwise) — a same-named
 *   method on an unrelated class must not inherit this test's pass/fail data. Standalone
 *   functions (absent from the map) keep the previous bare-name keying.
 */
export function matchRuntimeTests(
  runtime: JestRuntimeData | undefined,
  testFiles: TestFileNode[],
  rootDir: string,
  classMethodOwners: ClassMethodOwners = new Map()
): Map<string, MethodRuntimeResult> {
  const result = new Map<string, MethodRuntimeResult>();
  if (!runtime) return result;

  const testNodeIndex = buildTestNodeIndex(testFiles, rootDir);

  for (const rt of runtime.testResults) {
    const normalizedPath = normalizePath(rt.testFilePath, rootDir);
    const fileTests = testNodeIndex.get(normalizedPath);
    if (!fileTests) continue;

    for (const { testName, targetMethod, targetClass, targetClassFile } of fileTests) {
      if (!targetMethod) continue;
      if (!rt.testName.endsWith(testName)) continue;

      const key = resolveRuntimeKey(targetMethod, targetClass, targetClassFile, classMethodOwners);
      if (key) {
        if (!result.has(key)) {
          result.set(key, { passed: [], failed: [], skipped: [], perTest: [] });
        }
        const bucket = result.get(key)!;
        if (rt.status === 'passed') bucket.passed.push(testName);
        else if (rt.status === 'failed') bucket.failed.push(testName);
        else bucket.skipped.push(testName);
        bucket.perTest.push({ name: testName, status: rt.status, assertionCount: rt.assertionCount });
      }
      break;
    }
  }

  return result;
}

function resolveRuntimeKey(
  targetMethod: string,
  targetClass: string | null | undefined,
  targetClassFile: string | null | undefined,
  classMethodOwners: ClassMethodOwners
): string | null {
  const owners = classMethodOwners.get(targetMethod);
  if (owners && owners.size > 0) {
    // Class-owned: file-qualified key, failing closed when the owning class —
    // or its declaring file, for duplicated class names — can't be established.
    return resolveClassMethodKey(targetMethod, targetClass, targetClassFile, classMethodOwners);
  }
  return targetMethod;
}

function normalizePath(filePath: string, rootDir: string): string {
  if (path.isAbsolute(filePath)) {
    return path.relative(rootDir, filePath);
  }
  return filePath;
}

interface TestNodeIndexEntry {
  testName: string;
  targetMethod: string | null;
  targetClass: string | null;
  targetClassFile: string | null;
}

function buildTestNodeIndex(
  testFiles: TestFileNode[],
  rootDir: string
): Map<string, TestNodeIndexEntry[]> {
  const index = new Map<string, TestNodeIndexEntry[]>();
  for (const file of testFiles) {
    const entries: TestNodeIndexEntry[] = [];
    for (const block of file.describes) {
      for (const test of block.tests) {
        entries.push({
          testName: test.name,
          targetMethod: test.targetMethod,
          targetClass: test.targetClass ?? null,
          targetClassFile: test.targetClassFile ?? null,
        });
      }
    }
    // Extract produces absolute paths (globSync absolute: true) while Jest
    // runtime lookups are normalized to repo-relative — index in the same
    // key space so real runs actually match (task 022).
    index.set(normalizePath(file.filePath, rootDir), entries);
  }
  return index;
}
