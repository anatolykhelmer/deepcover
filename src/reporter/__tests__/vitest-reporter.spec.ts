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

const init = (reporter: DeepCoverVitestReporter, provider: string | undefined, reportsDirectory: string) =>
  reporter.onInit({ config: { coverage: { provider, reportsDirectory } } } as never);

describe('DeepCoverVitestReporter', () => {
  it('writes runtime.json with framework vitest and the configured provider', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, 'istanbul', path.join(dir, 'coverage'));
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
    init(reporter, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([
      fakeModule('/repo/src/a.spec.ts', [fakeCase('A > does b', 'passed')]),
    ] as never);

    const row = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).testResults[0];
    expect('assertionCount' in row).toBe(false);
  });

  it('records v8 as the provider when that is what ran', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, 'v8', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).coverageProvider).toBe('v8');
  });

  it('records "none" for a disabled or custom provider', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, undefined, path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).coverageProvider).toBe('none');
  });

  it('skips tests that never finished', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([
      fakeModule('/repo/src/a.spec.ts', [fakeCase('A > pending', 'pending')]),
    ] as never);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).testResults).toEqual([]);
  });

  it('writes a valid empty artifact when no test module ran', async () => {
    const dir = mkTmpDir();
    const reporter = new DeepCoverVitestReporter({ outputDir: dir });
    init(reporter, 'istanbul', path.join(dir, 'coverage'));
    await reporter.onTestRunEnd([] as never);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
    expect(data.testResults).toEqual([]);
    expect(data.framework).toBe('vitest');
  });
});
