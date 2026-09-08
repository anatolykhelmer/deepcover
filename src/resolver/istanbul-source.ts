import * as fs from 'fs';
import * as path from 'path';
import type { IstanbulCoverageData, RuntimeData } from './types';

/**
 * Jest writes `coverage-final.json` *after* every custom reporter's
 * `onRunComplete` has resolved — a coverage-enabled run rewrites the directory
 * only once reporters are done, and a run without `--coverage` leaves whatever
 * was already there untouched. A reporter therefore cannot copy that file for
 * the run it just observed — at best it copies the previous run's data (if the
 * directory still holds one from before), at worst it finds nothing at all.
 *
 * So `.deepcover/istanbul-coverage.json` can lag a run behind. The runner's coverage
 * directory, on the other hand, is guaranteed current by the time the CLI executes. We
 * read whichever source is newer. The runtime artifact is supplied by the caller rather
 * than re-read here, so there is one artifact read with one freshness rule instead of
 * two with different ones.
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

/** Absolute path to the runner's `coverage-final.json`, from the recorded directory. */
export function resolveCoverageFinalPath(coverageDirectory: string | undefined): string | undefined {
  if (!coverageDirectory) return undefined;
  const candidate = path.resolve(coverageDirectory, 'coverage-final.json');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function istanbulCandidates(deepcoverDir: string, runtime: RuntimeData | undefined): string[] {
  const copyPath = path.join(deepcoverDir, 'istanbul-coverage.json');
  const livePath = resolveCoverageFinalPath(runtime?.coverageDirectory);

  const candidates: string[] = [];
  if (livePath) candidates.push(livePath);
  if (fs.existsSync(copyPath)) candidates.push(copyPath);
  return candidates;
}

/**
 * Whether any coverage artifact is on disk, regardless of whether it will be used.
 * Lets the caller tell "nothing was measured and nothing is here" apart from "this run
 * measured nothing, and the file we found belongs to an earlier one".
 */
export function hasIstanbulSource(deepcoverDir: string, runtime: RuntimeData | undefined): boolean {
  return istanbulCandidates(deepcoverDir, runtime).length > 0;
}

/**
 * Load Istanbul coverage for a project, preferring the freshest available source.
 * Returns `undefined` when neither source is present or parseable — and when the run
 * recorded `coverageProvider: 'none'`, in which case both sources necessarily belong to
 * an earlier run. 0.9.0 loaded them and warned; that let a `--coverage`-less run be
 * scored against week-old data whenever nobody read the warning.
 */
export function loadIstanbulCoverage(
  deepcoverDir: string,
  runtime: RuntimeData | undefined
): IstanbulCoverageData | undefined {
  if (runtime?.coverageProvider === 'none') return undefined;

  const candidates = istanbulCandidates(deepcoverDir, runtime);
  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => mtimeOf(b) - mtimeOf(a));

  for (const candidate of candidates) {
    const data = readJson<IstanbulCoverageData>(candidate);
    if (data) return data;
  }
  return undefined;
}
