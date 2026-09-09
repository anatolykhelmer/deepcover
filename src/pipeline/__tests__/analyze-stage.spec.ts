import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePaths } from '../loaders';
import { runExtractStage } from '../extract-stage';
import { runAnalyzeStage } from '../analyze-stage';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('runAnalyzeStage', () => {
  let tmpDir: string;
  let deepcoverDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-analyze-stage-'));
    deepcoverDir = path.join(tmpDir, '.deepcover');
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: deepcoverDir });
    runExtractStage({ ...paths, module: FIXTURE, bugs: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scores from artifacts alone and never calls an LLM', () => {
    const { result, notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });

    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.perFunction)).toBe(true);
    expect(notes.join('\n')).toContain('reasoner-output.json');
  });

  it('errors with a hint when the code model is missing', () => {
    fs.rmSync(path.join(deepcoverDir, 'code-model.json'));
    expect(() => runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false })).toThrow(
      /deepcover extract/,
    );
  });

  it('notes deterministic-only scoring when reasoner output is absent', () => {
    fs.rmSync(path.join(deepcoverDir, 'reasoner-output.json'));
    const { result, notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });

    expect(typeof result.composite).toBe('number');
    expect(notes.join('\n')).toMatch(/deterministic/i);
    expect(notes.join('\n')).toContain('deepcover reason');
  });

  it('names the empty sections of a partially filled reasoner output', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'reasoner-output.json'),
      JSON.stringify({
        discoveredStates: [
          { className: 'A', methodName: 'b', state: 's', isTested: false, riskIfUntested: 'high', confidence: 0.9 },
        ],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: [],
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    const text = notes.join('\n');
    expect(text).toContain('Assertion Quality');
    expect(text).toContain('Criticality Weight');
    expect(text).not.toContain('State Coverage will use base score only');
  });

  it('reports an invalid reasoner output instead of scoring silently', () => {
    fs.writeFileSync(path.join(deepcoverDir, 'reasoner-output.json'), '{ broken');
    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.join('\n')).toMatch(/could not be read/i);
  });

  it('warns when a source file is newer than the extracted model', () => {
    const codeModelPath = path.join(deepcoverDir, 'code-model.json');
    const model = JSON.parse(fs.readFileSync(codeModelPath, 'utf-8'));
    const sourceFile: string = model.modules[0].filePath;
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(sourceFile, future, future);

    try {
      const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
      expect(notes.join('\n')).toMatch(/out of date/i);
    } finally {
      const now = new Date();
      fs.utimesSync(sourceFile, now, now);
    }
  });

  it('merges LLM bug findings from disk when bugs are enabled', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'reasoner-output.json'),
      JSON.stringify({
        discoveredStates: [],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: [],
        bugFindings: {
          findings: [
            {
              pattern: 'untested-invariant',
              className: 'ItemService',
              methodName: 'create',
              description: 'Validation not asserted',
              risk: 'high',
              suggestedTest: 'expect reject on invalid input',
            },
          ],
          signalValidations: [],
        },
      }),
    );

    const { result } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: true });
    expect(result.potentialBugs.some((b) => b.description.includes('Validation not asserted'))).toBe(true);
  });

  it('passes maxInfluence through to the scorer', () => {
    // `extract` writes an empty reasoner-output.json template, so overwrite it
    // with enough confirmed transitive inferences (30 → 60 points uncapped) to
    // exceed both caps under test.
    fs.writeFileSync(
      path.join(deepcoverDir, 'reasoner-output.json'),
      JSON.stringify({
        discoveredStates: [],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: Array.from({ length: 30 }, () => ({
          from: 'A.a',
          through: 'B.b',
          to: 'C.c',
          coveredTransitively: true,
          caveat: '',
          confidence: 1,
        })),
      }),
    );

    const tight = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false, maxInfluence: 0.02 });
    const loose = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false, maxInfluence: 0.2 });
    const omitted = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });

    // Assert the adjustment directly rather than the composite: the composite
    // also passes through weight redistribution and clamping, which could mask
    // the difference.
    expect(tight.result.subScores.mutationResilience.llmAdjustment).toBe(2);
    expect(loose.result.subScores.mutationResilience.llmAdjustment).toBe(20);
    expect(omitted.result.subScores.mutationResilience.llmAdjustment).toBe(20);
  });

  it('notes that --bugs is deterministic-only without LLM findings', () => {
    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: true });
    expect(notes.join('\n')).toContain('deepcover reason --bugs');
  });

  it('warns that operand-level analysis is unavailable when the artifact records no operand data', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'v8',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );
    // A real v8 run still produces Istanbul-shaped coverage-final.json (v8-to-istanbul
    // conversion); the note only fires when that data is actually in play — see 'does
    // not warn about a disabled operand analysis when there is no Istanbul data at all'
    // below for the negative case. (The two 'none'-provider tests below assert a
    // different note instead — the stale-coverage-ignored one — since a run that
    // ignored stale coverage has no Istanbul data at all, making the two branches
    // mutually exclusive by construction rather than by their order here.)
    fs.writeFileSync(
      path.join(deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify({
        '/fake/file.ts': { statementMap: {}, s: {}, branchMap: {}, b: {}, fnMap: {}, f: {} },
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('@vitest/coverage-istanbul'))).toBe(true);
  });

  it('names the Jest babel provider, not only a Vitest package, for a Jest+v8 run', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'jest',
        coverageProvider: 'v8',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );
    fs.writeFileSync(
      path.join(deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify({
        '/fake/file.ts': { statementMap: {}, s: {}, branchMap: {}, b: {}, fnMap: {}, f: {} },
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('coverageProvider "babel"'))).toBe(true);
  });

  it('does not warn about a disabled operand analysis when there is no Istanbul data at all', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'v8',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('@vitest/coverage-istanbul'))).toBe(false);
  });

  it('reports that stale coverage on disk was ignored when the run recorded "none"', () => {
    // Reproduces: run WITH --coverage, then again WITHOUT it. The second run records
    // 'none' while a coverage file from the first is still on disk. 0.10.0 refuses to
    // score against it — and must say so, or the user's situation is unchanged and they
    // now hear nothing at all.
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'none',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );
    fs.writeFileSync(
      path.join(deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify({
        '/fake/file.ts': { statementMap: {}, s: {}, branchMap: {}, b: {}, fnMap: {}, f: {} },
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('was ignored'))).toBe(true);
    expect(notes.some((n) => n.includes('re-run with --coverage'))).toBe(true);
  });

  // The case Fix A creates: Vitest's v8 provider does emit binary-expr, so an artifact
  // carrying them measures operands and must draw no warning, even though the recorded
  // provider is 'v8'.
  it('does not warn about operands for a v8 artifact that carries binary-expr branches', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'v8',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );
    fs.writeFileSync(
      path.join(deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify({
        '/fake/file.ts': {
          statementMap: {},
          s: {},
          branchMap: { '0': { loc: { start: { line: 5 }, end: { line: 5 } }, type: 'binary-expr' } },
          b: { '0': [1, 0] },
          fnMap: {},
          f: {},
        },
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('condition-operand analysis is disabled'))).toBe(false);
  });

  /**
   * A run recorded a real provider — coverage was configured — but neither the live
   * coverage-final.json nor a .deepcover copy exists, so hasIstanbulData is false and
   * ignoredStaleIstanbul (specific to coverageProvider 'none') stays false too. Neither
   * branch above fires, so before this test the score silently fell back to static
   * attribution with no explanation at all — indistinguishable from a project that
   * never configured coverage in the first place. Reproduces: a Vitest run that fails
   * with the default reportOnFailure: false (no report written, ac9e637), or coverage
   * enabled without `reporter: ['json']`.
   */
  it('explains a silent static fallback when coverage was configured but no data was found', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'istanbul',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('no coverage data was found'))).toBe(true);
  });

  it('does not warn about stale coverage when coverageProvider is "none" and no Istanbul file exists', () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'runtime.json'),
      JSON.stringify({
        framework: 'vitest',
        coverageProvider: 'none',
        coverageDirectory: path.join(deepcoverDir, 'coverage'),
        timestamp: new Date().toISOString(),
        testResults: [],
      }),
    );

    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: false });
    expect(notes.some((n) => n.includes('was ignored'))).toBe(false);
  });
});
