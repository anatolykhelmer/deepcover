import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { formatTerminalReport } from '../formatters/terminal';
import type { ScoreResult } from '../../scorer/types';

const CLI = 'npx tsx src/cli/index.ts';
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('analyze command', () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-analyze-cli-'));
    outDir = path.join(tmpDir, '.deepcover');
    execSync(`${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${outDir}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runAnalyze(args: string[]): string {
    return execSync(`${CLI} analyze --root ${tmpDir} ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
  }

  it('produces a terminal report from artifacts alone', () => {
    const output = runAnalyze([]);
    expect(output).toContain('Composite Score');
    expect(output).toContain('DeepCover Report');
  });

  it('produces JSON parseable as ScoreResult with --format json', () => {
    const parsed = JSON.parse(runAnalyze(['--format', 'json'])) as ScoreResult;
    expect(typeof parsed.composite).toBe('number');
    expect(parsed.subScores.assertionQuality).toBeDefined();
    expect(Array.isArray(parsed.perFunction)).toBe(true);
    expect(Array.isArray(parsed.potentialBugs)).toBe(true);
  });

  /**
   * `--min-score` used to be reachable only from `score`. 0.3.0 advertises it on
   * every `--format`, which means the gate must fire *and* the report must still
   * reach stdout — a gate that suppressed its own output would be useless in CI.
   */
  it('gates on --min-score while still printing JSON', () => {
    let failing: { status: number; stdout: string };
    try {
      const stdout = execSync(`${CLI} analyze --root ${tmpDir} --format json --min-score 100`, {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      failing = { status: 0, stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string };
      failing = { status: e.status, stdout: e.stdout };
    }

    expect(failing.status).toBe(1);
    expect((JSON.parse(failing.stdout) as ScoreResult).composite).toBeLessThan(100);

    const passing = execSync(`${CLI} analyze --root ${tmpDir} --format json --min-score 0`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    expect(typeof (JSON.parse(passing) as ScoreResult).composite).toBe('number');
  });

  it('never calls an LLM — no API key required', () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    expect(() =>
      execSync(`${CLI} analyze --root ${tmpDir}`, { encoding: 'utf-8', cwd: PROJECT_ROOT, env }),
    ).not.toThrow();
  });

  it('fails with a hint when nothing has been extracted', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-empty-'));
    try {
      execSync(`${CLI} analyze --root ${empty}`, { encoding: 'utf-8', cwd: PROJECT_ROOT, stdio: 'pipe' });
      throw new Error('expected a non-zero exit');
    } catch (err) {
      expect(String((err as { stderr?: Buffer }).stderr ?? err)).toContain('deepcover extract');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('rejects removed flags with a migration hint', () => {
    try {
      execSync(`${CLI} analyze --root ${tmpDir} --no-llm`, {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      throw new Error('expected a non-zero exit');
    } catch (err) {
      expect(String((err as { stderr?: Buffer }).stderr ?? err)).toContain('deepcover run --no-llm');
    }
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

/**
 * These used to write straight into `fixtures/assertion-quality/.deepcover` and call
 * `analyze --no-llm`. Under the new contract analyze only reads `.deepcover` — it never
 * extracts and `--no-llm` is a removed flag — so this now extracts into a temp dir first
 * (real `code-model.json`, from the real fixture source) and layers the synthetic Istanbul
 * / Jest-runtime artifacts on top before calling `analyze`, keeping the repo's fixture
 * directory untouched.
 */
describe('analyze command loads Jest data from .deepcover/', () => {
  let tmpDir: string;
  let deepcoverDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-analyze-istanbul-'));
    deepcoverDir = path.join(tmpDir, '.deepcover');
    execSync(`${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${deepcoverDir}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });

    const fixtureDir = path.resolve(PROJECT_ROOT, FIXTURE);
    const sourceAbsPath = path.resolve(fixtureDir, 'source.ts');

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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses Istanbul coverage data when .deepcover/istanbul-coverage.json exists', () => {
    const cmd = `${CLI} analyze --root ${tmpDir} --format json`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });
    const parsed = JSON.parse(output) as ScoreResult;

    const istanbulBacked = parsed.perFunction.filter(
      (fn: any) => fn.coverageSource === 'istanbul',
    );
    expect(istanbulBacked.length).toBeGreaterThan(0);
  });

  it('includes lineCoveragePercent in per-method breakdown', () => {
    const cmd = `${CLI} analyze --root ${tmpDir} --format json`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });
    const parsed = JSON.parse(output) as ScoreResult;

    const withLinePercent = parsed.perFunction.filter(
      (fn: any) => fn.lineCoveragePercent !== undefined,
    );
    expect(withLinePercent.length).toBeGreaterThan(0);
  });

  it('terminal output shows "with Jest runtime data" header', () => {
    const cmd = `${CLI} analyze --root ${tmpDir}`;
    const output = execSync(cmd, { encoding: 'utf-8', cwd: PROJECT_ROOT });

    expect(output).toContain('with Jest runtime data');
  });
});
