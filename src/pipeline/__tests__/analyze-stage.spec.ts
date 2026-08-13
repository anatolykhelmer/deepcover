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

  it('notes that --bugs is deterministic-only without LLM findings', () => {
    const { notes } = runAnalyzeStage({ rootDir: PROJECT_ROOT, deepcoverDir, bugs: true });
    expect(notes.join('\n')).toContain('deepcover reason --bugs');
  });
});
