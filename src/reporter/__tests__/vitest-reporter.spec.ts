import fs from 'fs';
import os from 'os';
import path from 'path';
import { DeepCoverVitestReporter } from '../vitest-reporter';

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dc-vitest-'));

const fakeCase = (fullName: string, state: string, duration = 1) => ({
  fullName,
  result: () => ({ state }),
  diagnostic: () => ({ duration }),
});

const fakeModule = (moduleId: string, cases: unknown[]) => ({
  moduleId,
  children: { allTests: () => cases[Symbol.iterator]() },
});

/**
 * Vitest's `ResolvedCoverageOptions` always has these fields defined — they are
 * exactly `FieldsWithDefaultValues` in `vitest/node`, so a plain `vitest run` with
 * no `--coverage` still resolves `provider: 'v8'` alongside `enabled: false`.
 * `provider` is never `undefined` in practice; only `enabled` says whether the run
 * measured anything. Building the fake from the full resolved shape (rather than
 * the `{ provider, reportsDirectory }` subset used before) is what exposed that.
 */
const fakeCoverageConfig = (
  enabled: boolean,
  provider: 'v8' | 'istanbul' | 'custom',
  reportsDirectory: string
) => ({
  provider,
  enabled,
  clean: true,
  cleanOnRerun: true,
  reportsDirectory,
  exclude: [] as string[],
  reportOnFailure: false,
  allowExternal: false,
  processingConcurrency: 1,
  reporter: [['text', {}]] as [string, object][],
  excludeAfterRemap: false,
  ignoreClassMethods: [] as string[],
  skipFull: false,
  watermarks: {},
});

const init = (
  reporter: DeepCoverVitestReporter,
  enabled: boolean,
  provider: 'v8' | 'istanbul' | 'custom',
  reportsDirectory: string
) => reporter.onInit({ config: { coverage: fakeCoverageConfig(enabled, provider, reportsDirectory) } } as never);

describe('DeepCoverVitestReporter', () => {
  it('writes runtime.json with framework vitest and the configured provider', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([
      fakeModule('/repo/src/a.spec.ts', [fakeCase('A > does b', 'passed', 3)]),
    ] as never);

    const data = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
    expect(data.framework).toBe('vitest');
    expect(data.coverageProvider).toBe('istanbul');
    expect(data.coverageDirectory).toBe(path.resolve(dir, 'coverage'));
    expect(data.testResults).toEqual([
      { testFilePath: '/repo/src/a.spec.ts', testName: 'A > does b', status: 'passed', duration: 3 },
    ]);
  });

  it('omits assertionCount entirely rather than writing 0', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([
      fakeModule('/repo/src/a.spec.ts', [fakeCase('A > does b', 'passed')]),
    ] as never);

    const row = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).testResults[0];
    expect('assertionCount' in row).toBe(false);
  });

  it('records v8 as the provider when that is what ran', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'v8', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).coverageProvider).toBe('v8');
  });

  it('records "none" and skips the coverage-final.json copy when coverage is not enabled', async () => {
    // This is the real default of a plain `vitest run` with no `--coverage`:
    // `enabled: false` alongside `provider: 'v8'` (Vitest resolves `provider` to a
    // real value regardless of whether coverage ran).
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    // Planted so the copy would happen if the enabled-gate were missing — a test
    // that passes only because this file is absent proves nothing. Driven through the
    // copy's own hook, since asserting after onTestRunEnd alone would pass with the
    // gate deleted: that method no longer copies under any provider.
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ stale: true }));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, false, 'v8', coverageDir);
    await reporter.onTestRunEnd([] as never);
    await reporter.onFinishedReportCoverage();

    const data = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
    expect(data.coverageProvider).toBe('none');
    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  it('records "none" for a custom provider', async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ stale: true }));
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'custom', coverageDir);
    await reporter.onTestRunEnd([] as never);
    // The reachable half of the gate: Vitest fires this hook for a custom provider,
    // because one *is* configured — only DeepCover's own mapping calls it 'none'.
    await reporter.onFinishedReportCoverage();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).coverageProvider).toBe('none');
    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  it('skips tests that never finished', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([
      fakeModule('/repo/src/a.spec.ts', [fakeCase('A > pending', 'pending')]),
    ] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).testResults).toEqual([]);
  });

  it('writes a valid empty artifact when no test module ran', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
    expect(data.testResults).toEqual([]);
    expect(data.framework).toBe('vitest');
  });

  /**
   * The real sequence of a coverage-enabled `vitest run`: Vitest's provider cleans the
   * coverage directory before the first test, core fires onTestRunEnd, and only then is
   * coverage-final.json written — so the report for the run just observed exists from
   * onFinishedReportCoverage onwards and never before it. Seeding a previous run's file
   * and asserting on the copy's *contents* is what distinguishes "snapshotted this run"
   * from "snapshotted whatever happened to be lying in the directory".
   */
  it("copies the coverage report this run produced, not the previous run's", async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    const coverageFinal = path.join(coverageDir, 'coverage-final.json');
    fs.writeFileSync(coverageFinal, JSON.stringify({ run: 'previous' }));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', coverageDir);
    await reporter.onTestRunEnd([] as never);
    fs.writeFileSync(coverageFinal, JSON.stringify({ run: 'current' }));
    await reporter.onFinishedReportCoverage();

    const copied = JSON.parse(fs.readFileSync(path.join(dir, 'istanbul-coverage.json'), 'utf-8'));
    expect(copied).toEqual({ run: 'current' });
  });

  it("leaves the previous run's report uncopied at test-run end", async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ run: 'previous' }));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', coverageDir);
    await reporter.onTestRunEnd([] as never);

    // Copying here would stamp the previous run's data with a fresh mtime — the exact
    // signal istanbul-source.ts's live-vs-copy freshness pick relies on.
    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  /**
   * Vitest skips onFinishedReportCoverage entirely when the run failed and
   * reportOnFailure is off (the default): reportCoverage() returns before
   * dispatching it, right after the provider has already wiped the coverage
   * directory. A copy from an earlier successful run would otherwise outlive this
   * one — surviving under a coverageProvider that is not 'none', so nothing marks
   * it stale — and get loaded as if it belonged to the run that just failed.
   */
  it("drops a previous run's copy when this run's onTestRunEnd fires", async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'istanbul-coverage.json'), JSON.stringify({ run: 'previous' }));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', coverageDir);
    await reporter.onTestRunEnd([] as never);
    // onFinishedReportCoverage is deliberately not called: this reproduces the run
    // that fails and never reaches it.

    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  /**
   * `{ force: true }` on rmSync suppresses ENOENT (file already absent) but not
   * EISDIR/EACCES (something exists at that path but can't be removed this way) — a
   * directory standing in for the file reproduces that portably. onTestRunEnd must not
   * let this crash the run over a best-effort cleanup, the same guarantee
   * onFinishedReportCoverage already gives its own copyFileSync.
   */
  it("does not fail the run when the previous copy can't be removed", async () => {
    const dir = mkTmpDir();
    fs.mkdirSync(path.join(dir, 'istanbul-coverage.json'));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', path.join(dir, 'coverage'));

    // A rejection here propagates out of Vitest's `_testRun.end()` and fails the run.
    await reporter.onTestRunEnd([] as never);
  });

  it('reports coverage without a copy when no report was written', async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', coverageDir);
    await reporter.onTestRunEnd([] as never);
    await reporter.onFinishedReportCoverage();

    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  /**
   * The snapshot is best-effort and the CLI always has the live coverage directory to
   * fall back on, so a failed copy must not take the user's test run down with it —
   * onFinishedReportCoverage rejecting would surface as a failed `vitest run`. A
   * directory standing where the report belongs makes the copy fail portably while
   * still passing the existence check.
   */
  it('does not fail the run when the report cannot be copied', async () => {
    const dir = mkTmpDir();
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(path.join(coverageDir, 'coverage-final.json'), { recursive: true });

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'istanbul', coverageDir);
    await reporter.onTestRunEnd([] as never);

    // A rejection here propagates out of Vitest's reportCoverage() and fails the run.
    await reporter.onFinishedReportCoverage();
  });
});
