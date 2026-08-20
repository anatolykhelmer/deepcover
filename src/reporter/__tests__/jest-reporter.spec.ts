import fs from 'fs';
import path from 'path';
import os from 'os';
import { DeepCoverReporter } from '../jest-reporter';
import type { AggregatedResult } from '@jest/reporters';

function createMockAggregatedResult(overrides?: Partial<AggregatedResult>): AggregatedResult {
  return {
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: 2,
    numPassedTestSuites: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    numPendingTestSuites: 0,
    numRuntimeErrorTestSuites: 0,
    numTotalTests: 2,
    numTotalTestSuites: 1,
    openHandles: [],
    snapshot: {
      added: 0,
      didUpdate: false,
      failure: false,
      filesAdded: 0,
      filesRemoved: 0,
      filesRemovedList: [],
      filesUnmatched: 0,
      filesUpdated: 0,
      matched: 0,
      total: 0,
      unchecked: 0,
      uncheckedKeysByFile: [],
      unmatched: 0,
      updated: 0,
    },
    startTime: Date.now(),
    success: true,
    testResults: [
      {
        testFilePath: '/project/src/foo.spec.ts',
        testResults: [
          {
            ancestorTitles: ['Foo'],
            duration: 10,
            fullName: 'Foo should pass',
            numPassingAsserts: 3,
            status: 'passed',
            title: 'should pass',
            failureMessages: [],
            failureDetails: [],
          },
          {
            ancestorTitles: ['Foo'],
            duration: 5,
            fullName: 'Foo should also pass',
            numPassingAsserts: 1,
            status: 'passed',
            title: 'should also pass',
            failureMessages: [],
            failureDetails: [],
          },
        ],
        numFailingTests: 0,
        numPassingTests: 2,
        numPendingTests: 0,
        numTodoTests: 0,
        openHandles: [],
        perfStats: {
          end: 0,
          loadTestEnvironmentEnd: 0,
          loadTestEnvironmentStart: 0,
          runtime: 0,
          setupAfterEnvEnd: 0,
          setupAfterEnvStart: 0,
          setupFilesEnd: 0,
          setupFilesStart: 0,
          slow: false,
          start: 0,
        },
        skipped: false,
        snapshot: {
          added: 0,
          fileDeleted: false,
          matched: 0,
          unchecked: 0,
          uncheckedKeys: [],
          unmatched: 0,
          updated: 0,
        },
        leaks: false,
      },
    ],
    wasInterrupted: false,
    ...overrides,
  };
}

describe('DeepCoverReporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-reporter-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  /**
   * A reporter pointed at a coverage directory that does not exist.
   *
   * `globalConfig.coverageDirectory` defaults to `'./coverage'` resolved
   * against `process.cwd()`, so passing `{}` here makes the reporter read this
   * repo's own `coverage/` directory. On any machine that has run
   * `npm test -- --coverage` that directory holds a real `coverage-final.json`,
   * which the reporter then copies into the test's output directory — green on
   * a fresh clone, red locally. Every test that does not deliberately provide
   * coverage data must go through this helper.
   */
  function isolatedReporter(options: { outputDir: string }): DeepCoverReporter {
    return new DeepCoverReporter({ coverageDirectory: path.join(tmpDir, 'no-coverage-here') }, options);
  }

  it('captures test results from mocked AggregatedResult', async () => {
    const reporter = isolatedReporter({ outputDir: tmpDir });
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const outputPath = path.join(tmpDir, 'jest-runtime.json');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('writes to the configured output directory', async () => {
    const customDir = path.join(tmpDir, 'custom-output');
    const reporter = isolatedReporter({ outputDir: customDir });
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const outputPath = path.join(customDir, 'jest-runtime.json');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('output file contains valid JSON with testResults array', async () => {
    const reporter = isolatedReporter({ outputDir: tmpDir });
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const content = fs.readFileSync(path.join(tmpDir, 'jest-runtime.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed.testResults)).toBe(true);
    expect(parsed.testResults).toHaveLength(2);
  });

  it('each test result has testFilePath, testName, status, duration, assertionCount', async () => {
    const reporter = isolatedReporter({ outputDir: tmpDir });
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const content = fs.readFileSync(path.join(tmpDir, 'jest-runtime.json'), 'utf-8');
    const parsed = JSON.parse(content);

    for (const tr of parsed.testResults) {
      expect(tr).toHaveProperty('testFilePath');
      expect(tr).toHaveProperty('testName');
      expect(tr).toHaveProperty('status');
      expect(tr).toHaveProperty('duration');
      expect(tr).toHaveProperty('assertionCount');
    }

    expect(parsed.testResults[0]).toMatchObject({
      testFilePath: '/project/src/foo.spec.ts',
      testName: 'Foo should pass',
      status: 'passed',
      duration: 10,
      assertionCount: 3,
    });
  });

  it('copies coverage-final.json to outputDir when it exists', async () => {
    const coverageDir = path.join(tmpDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    const coverageData = { '/project/src/foo.ts': { statementMap: {}, s: {}, branchMap: {}, b: {}, fnMap: {}, f: {} } };
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify(coverageData));

    const outputDir = path.join(tmpDir, 'deepcover-out');
    const reporter = new DeepCoverReporter(
      { coverageDirectory: coverageDir },
      { outputDir }
    );
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const istanbulPath = path.join(outputDir, 'istanbul-coverage.json');
    expect(fs.existsSync(istanbulPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(istanbulPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed['/project/src/foo.ts']).toBeDefined();
  });

  it('does not fail when coverage-final.json does not exist', async () => {
    const outputDir = path.join(tmpDir, 'deepcover-out2');
    const coverageDir = path.join(tmpDir, 'no-coverage-here');
    expect(fs.existsSync(coverageDir)).toBe(false);

    const reporter = new DeepCoverReporter({ coverageDirectory: coverageDir }, { outputDir });
    const results = createMockAggregatedResult();
    await reporter.onRunComplete!(new Set(), results);

    const istanbulPath = path.join(outputDir, 'istanbul-coverage.json');
    expect(fs.existsSync(istanbulPath)).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'jest-runtime.json'))).toBe(true);
  });
});
