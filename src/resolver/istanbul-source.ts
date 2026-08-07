import * as fs from 'fs';
import * as path from 'path';
import type { IstanbulCoverageData, JestRuntimeData } from './types';

/**
 * Jest writes `coverage-final.json` *after* every custom reporter's
 * `onRunComplete` has resolved, and it clears the coverage directory before the
 * run. A reporter therefore cannot copy that file for the run it just observed —
 * at best it copies the previous run's data, at worst it finds nothing at all.
 *
 * So `.deepcover/istanbul-coverage.json` can lag a run behind. The Jest coverage
 * directory, on the other hand, is guaranteed to be current by the time the CLI
 * executes. We read whichever source is newer, which keeps older `.deepcover`
 * directories (written by previous versions, or copied between machines without
 * a coverage directory) working unchanged.
 */

function readJson<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

function mtimeOf(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

/** Absolute path to Jest's `coverage-final.json`, as recorded by the reporter. */
export function resolveCoverageFinalPath(deepcoverDir: string): string | undefined {
  const runtime = readJson<JestRuntimeData & { coverageDirectory?: string }>(
    path.join(deepcoverDir, 'jest-runtime.json'),
  );
  if (!runtime?.coverageDirectory) return undefined;

  const candidate = path.resolve(runtime.coverageDirectory, 'coverage-final.json');
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * Load Istanbul coverage for a project, preferring the freshest available source.
 * Returns `undefined` when neither source is present or parseable.
 */
export function loadIstanbulCoverage(deepcoverDir: string): IstanbulCoverageData | undefined {
  const copyPath = path.join(deepcoverDir, 'istanbul-coverage.json');
  const livePath = resolveCoverageFinalPath(deepcoverDir);

  const candidates: string[] = [];
  if (livePath) candidates.push(livePath);
  if (fs.existsSync(copyPath)) candidates.push(copyPath);
  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => mtimeOf(b) - mtimeOf(a));

  for (const candidate of candidates) {
    const data = readJson<IstanbulCoverageData>(candidate);
    if (data) return data;
  }
  return undefined;
}
