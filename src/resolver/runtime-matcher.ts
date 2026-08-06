import path from 'path';
import type { JestRuntimeData } from './types';
import type { TestFileNode } from '../types/code-model';

export interface MethodRuntimeResult {
  passed: string[];
  failed: string[];
  skipped: string[];
  perTest: { name: string; status: 'passed' | 'failed' | 'skipped'; assertionCount: number }[];
}

export function matchRuntimeTests(
  runtime: JestRuntimeData | undefined,
  testFiles: TestFileNode[],
  rootDir: string
): Map<string, MethodRuntimeResult> {
  const result = new Map<string, MethodRuntimeResult>();
  if (!runtime) return result;

  const testNodeIndex = buildTestNodeIndex(testFiles, rootDir);

  for (const rt of runtime.testResults) {
    const normalizedPath = normalizePath(rt.testFilePath, rootDir);
    const fileTests = testNodeIndex.get(normalizedPath);
    if (!fileTests) continue;

    for (const { testName, targetMethod } of fileTests) {
      if (!targetMethod) continue;
      if (!rt.testName.endsWith(testName)) continue;

      if (!result.has(targetMethod)) {
        result.set(targetMethod, { passed: [], failed: [], skipped: [], perTest: [] });
      }
      const bucket = result.get(targetMethod)!;
      if (rt.status === 'passed') bucket.passed.push(testName);
      else if (rt.status === 'failed') bucket.failed.push(testName);
      else bucket.skipped.push(testName);
      bucket.perTest.push({ name: testName, status: rt.status, assertionCount: rt.assertionCount });
      break;
    }
  }

  return result;
}

function normalizePath(filePath: string, rootDir: string): string {
  if (path.isAbsolute(filePath)) {
    return path.relative(rootDir, filePath);
  }
  return filePath;
}

function buildTestNodeIndex(
  testFiles: TestFileNode[],
  _rootDir: string
): Map<string, { testName: string; targetMethod: string | null }[]> {
  const index = new Map<string, { testName: string; targetMethod: string | null }[]>();
  for (const file of testFiles) {
    const entries: { testName: string; targetMethod: string | null }[] = [];
    for (const block of file.describes) {
      for (const test of block.tests) {
        entries.push({ testName: test.name, targetMethod: test.targetMethod });
      }
    }
    index.set(file.filePath, entries);
  }
  return index;
}
