import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { formatTerminalReport } from '../formatters/terminal';
import type { ScoreResult } from '../../scorer/types';

const CLI = 'npx tsx src/cli/index.ts';
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

function runAnalyze(args: string[]): string {
  const cmd = `${CLI} analyze --root ${PROJECT_ROOT} --module ${FIXTURE} ${args.join(' ')}`;
  return execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });
}

describe('analyze command', () => {
  it('produces valid terminal output containing "Composite Score" with --no-llm', () => {
    const output = runAnalyze(['--no-llm']);
    expect(output).toContain('Composite Score');
    expect(output).toContain('DeepCover Report');
    expect(output).toContain('════════════════');
  });

  it('produces valid JSON parseable as ScoreResult with --format json', () => {
    const output = runAnalyze(['--no-llm', '--format', 'json']);
    const parsed = JSON.parse(output) as ScoreResult;
    expect(typeof parsed.composite).toBe('number');
    expect(parsed.subScores).toBeDefined();
    expect(parsed.subScores.assertionQuality).toBeDefined();
    expect(parsed.subScores.stateCoverage).toBeDefined();
    expect(parsed.subScores.mutationResilience).toBeDefined();
    expect(parsed.subScores.criticalityWeighting).toBeDefined();
    expect(Array.isArray(parsed.perFunction)).toBe(true);
    expect(Array.isArray(parsed.gaps)).toBe(true);
    expect(Array.isArray(parsed.potentialBugs)).toBe(true);
  });

  it('--no-llm mode works without API key', () => {
    expect(() => runAnalyze(['--no-llm'])).not.toThrow();
  });

  it('terminal formatter produces bar charts and gap list', () => {
    const result: ScoreResult = {
      composite: 47,
      subScores: {
        assertionQuality: { base: 62, llmAdjustment: 0, final: 62, confidence: 0, applicable: true },
        stateCoverage: { base: 38, llmAdjustment: 0, final: 38, confidence: 0, applicable: true },
        mutationResilience: { base: 41, llmAdjustment: 0, final: 41, confidence: 0, applicable: true },
        criticalityWeighting: { base: 51, llmAdjustment: 0, final: 51, confidence: 0, applicable: true },
      },
      perFunction: [
        { className: 'ServiceName', methodName: 'methodA', composite: 72, criticality: 'low', testedStates: 2, totalStates: 2, strongAssertions: 3, weakAssertions: 0, untested: [] },
        { className: 'ServiceName', methodName: 'methodB', composite: 23, criticality: 'high', testedStates: 0, totalStates: 1, strongAssertions: 0, weakAssertions: 1, untested: ['state'] },
        { className: 'ServiceName', methodName: 'methodC', composite: 0, criticality: 'low', testedStates: 0, totalStates: 0, strongAssertions: 0, weakAssertions: 0, untested: ['no test coverage'] },
      ],
      gaps: [
        { rank: 1, className: 'ClassName', methodName: 'method', scenario: 'scenario description', risk: 'high', reason: 'r', suggestedTest: 't' },
        { rank: 2, className: 'ClassName', methodName: 'method', scenario: 'scenario description', risk: 'medium', reason: 'r', suggestedTest: 't' },
      ],
      potentialBugs: [],
    };
    const formatted = formatTerminalReport(result);
    expect(formatted).toContain('█');
    expect(formatted).toContain('░');
    expect(formatted).toContain('Per-method breakdown');
    expect(formatted).toContain('Top gaps');
    expect(formatted).toContain('#1 HIGH');
    expect(formatted).toContain('#2 MED');
    expect(formatted).toContain('✅');
    expect(formatted).toContain('⚠️');
    expect(formatted).toContain('❌');
  });
});

describe('analyze command loads Jest data from .deepcover/', () => {
  const fixtureDir = path.resolve(PROJECT_ROOT, FIXTURE);
  const deepcoverDir = path.join(fixtureDir, '.deepcover');
  const sourceAbsPath = path.resolve(fixtureDir, 'source.ts');

  beforeAll(() => {
    fs.mkdirSync(deepcoverDir, { recursive: true });

    // Istanbul coverage for source.ts — getAll (13-15), getById (17-21), create (23-25)
    const istanbul = {
      [sourceAbsPath]: {
        statementMap: {
          '0': { start: { line: 14, column: 4 }, end: { line: 14, column: 35 } },
          '1': { start: { line: 18, column: 4 }, end: { line: 18, column: 50 } },
          '2': { start: { line: 19, column: 4 }, end: { line: 19, column: 44 } },
          '3': { start: { line: 20, column: 4 }, end: { line: 20, column: 16 } },
          '4': { start: { line: 24, column: 4 }, end: { line: 24, column: 33 } },
        },
        s: { '0': 5, '1': 3, '2': 1, '3': 2, '4': 4 },
        branchMap: {
          '0': { loc: { start: { line: 19 }, end: { line: 19 } }, type: 'if' },
        },
        b: { '0': [1, 2] },
        fnMap: {},
        f: {},
      },
    };
    fs.writeFileSync(
      path.join(deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify(istanbul),
    );

    const runtime = {
      testResults: [
        { testFilePath: path.resolve(fixtureDir, 'strong-tests.spec.ts'), testName: 'ItemService getAll should return all items', status: 'passed', duration: 5, assertionCount: 2 },
        { testFilePath: path.resolve(fixtureDir, 'strong-tests.spec.ts'), testName: 'ItemService getById should return item by id', status: 'passed', duration: 3, assertionCount: 3 },
      ],
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(deepcoverDir, 'jest-runtime.json'),
      JSON.stringify(runtime),
    );
  });

  afterAll(() => {
    fs.rmSync(deepcoverDir, { recursive: true, force: true });
  });

  it('uses Istanbul coverage data when .deepcover/istanbul-coverage.json exists', () => {
    const cmd = `${CLI} analyze --root ${fixtureDir} --no-llm --format json`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });
    const parsed = JSON.parse(output) as ScoreResult;

    const istanbulBacked = parsed.perFunction.filter(
      (fn: any) => fn.coverageSource === 'istanbul',
    );
    expect(istanbulBacked.length).toBeGreaterThan(0);
  });

  it('includes lineCoveragePercent in per-method breakdown', () => {
    const cmd = `${CLI} analyze --root ${fixtureDir} --no-llm --format json`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });
    const parsed = JSON.parse(output) as ScoreResult;

    const withLinePercent = parsed.perFunction.filter(
      (fn: any) => fn.lineCoveragePercent !== undefined,
    );
    expect(withLinePercent.length).toBeGreaterThan(0);
  });

  it('terminal output shows "with Jest runtime data" header', () => {
    const cmd = `${CLI} analyze --root ${fixtureDir} --no-llm`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });

    expect(output).toContain('with Jest runtime data');
  });
});
