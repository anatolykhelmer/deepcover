import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasIstanbulSource, loadIstanbulCoverage, resolveCoverageFinalPath } from '../istanbul-source';
import type { RuntimeData } from '../types';

function fileCoverage(hits: number) {
  return {
    statementMap: { '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
    s: { '0': hits },
    branchMap: {},
    b: {},
    fnMap: {},
    f: {},
  };
}

describe('istanbul-source', () => {
  let root: string;
  let deepcoverDir: string;
  let coverageDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-istanbul-'));
    deepcoverDir = path.join(root, '.deepcover');
    coverageDir = path.join(root, 'coverage');
    fs.mkdirSync(deepcoverDir);
    fs.mkdirSync(coverageDir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runtime(provider: 'istanbul' | 'v8' | 'none', withCoverageDir = true): RuntimeData {
    return {
      framework: 'jest',
      coverageProvider: provider,
      coverageDirectory: withCoverageDir ? coverageDir : '',
      timestamp: new Date().toISOString(),
      testResults: [],
    };
  }

  function writeCopy(hits: number, mtimeMs: number) {
    const p = path.join(deepcoverDir, 'istanbul-coverage.json');
    fs.writeFileSync(p, JSON.stringify({ 'src/a.ts': fileCoverage(hits) }));
    fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  }

  function writeLive(hits: number, mtimeMs: number) {
    const p = path.join(coverageDir, 'coverage-final.json');
    fs.writeFileSync(p, JSON.stringify({ 'src/a.ts': fileCoverage(hits) }));
    fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  }

  it('returns undefined when neither source exists', () => {
    expect(loadIstanbulCoverage(deepcoverDir, runtime('istanbul'))).toBeUndefined();
  });

  it('reads the .deepcover copy when no coverage directory is recorded', () => {
    writeCopy(7, Date.now());

    expect(loadIstanbulCoverage(deepcoverDir, runtime('istanbul', false))?.['src/a.ts'].s['0']).toBe(7);
  });

  // The regression this module exists for: Jest writes coverage-final.json after
  // the reporter runs, so the .deepcover copy is a run behind.
  it('prefers the live coverage file when it is newer than the stale copy', () => {
    const now = Date.now();
    writeCopy(0, now - 60_000);
    writeLive(12, now);

    expect(loadIstanbulCoverage(deepcoverDir, runtime('istanbul'))?.['src/a.ts'].s['0']).toBe(12);
  });

  it('keeps the copy when it is the newer of the two', () => {
    const now = Date.now();
    writeCopy(12, now);
    writeLive(0, now - 60_000);

    expect(loadIstanbulCoverage(deepcoverDir, runtime('istanbul'))?.['src/a.ts'].s['0']).toBe(12);
  });

  it('falls back to the readable source when the newest one is malformed', () => {
    const now = Date.now();
    writeCopy(9, now - 60_000);
    const live = path.join(coverageDir, 'coverage-final.json');
    fs.writeFileSync(live, '{ not json');
    fs.utimesSync(live, now / 1000, now / 1000);

    expect(loadIstanbulCoverage(deepcoverDir, runtime('istanbul'))?.['src/a.ts'].s['0']).toBe(9);
  });

  // Reverses 0.9.0's "warn but load anyway". A run that recorded 'none' measured
  // nothing, so every coverage file on disk belongs to some earlier run, and scoring
  // against it reports last week's numbers as this run's.
  it('loads nothing when the run recorded coverageProvider "none"', () => {
    const now = Date.now();
    writeCopy(12, now);
    writeLive(12, now);

    expect(loadIstanbulCoverage(deepcoverDir, runtime('none'))).toBeUndefined();
  });

  it('still reports that a source was on disk when "none" suppressed it', () => {
    writeLive(12, Date.now());

    expect(hasIstanbulSource(deepcoverDir, runtime('none'))).toBe(true);
  });

  // The back-compat path: a hand-placed or pre-0.9.0 .deepcover has no runtime artifact
  // at all. `undefined` is not `'none'`, and must keep loading exactly as before.
  it('loads normally when there is no runtime artifact at all', () => {
    writeCopy(7, Date.now());

    expect(loadIstanbulCoverage(deepcoverDir, undefined)?.['src/a.ts'].s['0']).toBe(7);
  });

  describe('resolveCoverageFinalPath', () => {
    it('resolves the recorded coverage directory', () => {
      writeLive(1, Date.now());

      expect(resolveCoverageFinalPath(coverageDir)).toBe(
        path.resolve(coverageDir, 'coverage-final.json'),
      );
    });

    it('returns undefined when the recorded file is absent', () => {
      expect(resolveCoverageFinalPath(coverageDir)).toBeUndefined();
    });

    it('returns undefined when no directory was recorded', () => {
      expect(resolveCoverageFinalPath(undefined)).toBeUndefined();
    });
  });
});
