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
    // that passes only because this file is absent proves nothing.
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ stale: true }));

    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, false, 'v8', coverageDir);
    await reporter.onTestRunEnd([] as never);

    const data = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
    expect(data.coverageProvider).toBe('none');
    expect(fs.existsSync(path.join(dir, 'istanbul-coverage.json'))).toBe(false);
  });

  it('records "none" for a custom provider', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, true, 'custom', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).coverageProvider).toBe('none');
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
});
