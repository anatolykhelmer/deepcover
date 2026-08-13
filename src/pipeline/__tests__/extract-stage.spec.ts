import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePaths } from '../loaders';
import { runExtractStage } from '../extract-stage';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('runExtractStage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-extract-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes artifacts under <root>/.deepcover even when CWD is elsewhere', () => {
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    const result = runExtractStage({ ...paths, module: FIXTURE, bugs: false });

    expect(fs.existsSync(path.join(tmpDir, '.deepcover', 'code-model.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.deepcover', 'prompts.json'))).toBe(true);
    expect(result.writtenFiles.every((f) => f.startsWith(tmpDir))).toBe(true);
  });

  it('defaults the artifact directory to the root, not process.cwd()', () => {
    // Regression: extract used to resolve --output relative to CWD, so
    // `--root ../other` scattered artifacts into the current project.
    //
    // Hermetic by construction: chdir into a scratch directory distinct from
    // `rootCopy` before running the stage, so the "not CWD" assertion below
    // checks a CWD we control instead of the real repo root (which can carry
    // a stray .deepcover/ from unrelated local runs and make this pass for
    // the wrong reason, or fail for one).
    const originalCwd = process.cwd();
    const cwdScratch = path.join(tmpDir, 'cwd-scratch');
    fs.mkdirSync(cwdScratch, { recursive: true });
    process.chdir(cwdScratch);

    try {
      const rootCopy = path.join(tmpDir, 'proj');
      fs.mkdirSync(path.join(rootCopy, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(rootCopy, 'src', 'thing.ts'),
        'export class Thing { run(): number { return 1; } }\n',
      );

      const paths = resolvePaths({ root: rootCopy, module: 'src' });
      runExtractStage({ ...paths, module: 'src', bugs: false });

      expect(fs.existsSync(path.join(rootCopy, '.deepcover', 'code-model.json'))).toBe(true);
      expect(fs.existsSync(path.join(cwdScratch, '.deepcover', 'code-model.json'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('writes bug signals and a fifth prompt when bugs are enabled', () => {
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    const result = runExtractStage({ ...paths, module: FIXTURE, bugs: true });

    const signalsPath = path.join(tmpDir, '.deepcover', 'bug-signals.json');
    expect(fs.existsSync(signalsPath)).toBe(true);
    expect(Array.isArray(JSON.parse(fs.readFileSync(signalsPath, 'utf-8')))).toBe(true);
    expect(result.bugSignalCount).toBeGreaterThanOrEqual(0);

    const prompts = JSON.parse(fs.readFileSync(path.join(tmpDir, '.deepcover', 'prompts.json'), 'utf-8'));
    expect(prompts.bugFinding).toBeDefined();
  });

  it('seeds a reasoner-output template that matches the bugs flag', () => {
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    runExtractStage({ ...paths, module: FIXTURE, bugs: true });

    const template = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8'),
    );
    expect(template.discoveredStates).toEqual([]);
    expect(template.bugFindings).toEqual({ findings: [], signalValidations: [] });
  });

  it('does not overwrite an existing filled reasoner-output.json', () => {
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    runExtractStage({ ...paths, module: FIXTURE, bugs: false });

    const outputPath = path.join(tmpDir, '.deepcover', 'reasoner-output.json');
    const filled = {
      discoveredStates: [
        { className: 'A', methodName: 'b', state: 's', isTested: true, riskIfUntested: 'low', confidence: 0.5 },
      ],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
    };
    fs.writeFileSync(outputPath, JSON.stringify(filled));

    const second = runExtractStage({ ...paths, module: FIXTURE, bugs: false });
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8')).discoveredStates).toHaveLength(1);
    expect(second.notes.join('\n')).toContain('reasoner-output.json');
  });

  it('does not overwrite a reasoner-output.json whose bugFindings are filled but the base arrays are empty', () => {
    // An agent can run --bugs, fill in bugFindings, and leave the four base
    // arrays empty (a realistic incremental workflow) — that must not read as
    // "untouched" just because those four arrays are.
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    runExtractStage({ ...paths, module: FIXTURE, bugs: true });

    const outputPath = path.join(tmpDir, '.deepcover', 'reasoner-output.json');
    const partiallyFilled = {
      discoveredStates: [],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
      bugFindings: {
        findings: [
          {
            pattern: 'untested-invariant',
            className: 'A',
            methodName: 'b',
            description: 'x',
            risk: 'high',
            suggestedTest: 'y',
          },
        ],
        signalValidations: [],
      },
    };
    fs.writeFileSync(outputPath, JSON.stringify(partiallyFilled));

    const second = runExtractStage({ ...paths, module: FIXTURE, bugs: true });
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8')).bugFindings.findings).toHaveLength(1);
    expect(second.notes.join('\n')).toContain('reasoner-output.json');
  });

  it('replaces an unparseable reasoner-output.json and notes why', () => {
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: path.join(tmpDir, '.deepcover') });
    runExtractStage({ ...paths, module: FIXTURE, bugs: false });

    const outputPath = path.join(tmpDir, '.deepcover', 'reasoner-output.json');
    fs.writeFileSync(outputPath, '{ not valid json');

    const second = runExtractStage({ ...paths, module: FIXTURE, bugs: false });
    const rewritten = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(rewritten.discoveredStates).toEqual([]);
    expect(second.notes.join('\n')).toContain('could not be parsed');
  });

  it('boosts the unhandled-error-path bug-signal confidence when Istanbul coverage becomes available', () => {
    // Pins the extract-stage call site: computeBugSignals(codeModel, rootDir, deepcoverDir)
    // takes two adjacent `string` params, and swapping them would silently break
    // Istanbul-awareness here without TypeScript ever noticing.
    const rootDir = path.join(tmpDir, 'istanbul-proj');
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    // `if (flag)` gives Istanbul a branch to under-cover; the `throw` (anywhere
    // in the body) makes the method's `throwsErrors` true.
    fs.writeFileSync(
      path.join(rootDir, 'src', 'thing.ts'),
      [
        'export class ErrorService {',
        '  risky(flag: boolean): void {',
        '    if (flag) {',
        "      console.log('branch');",
        '    }',
        "    throw new Error('boom');",
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const paths = resolvePaths({ root: rootDir, module: 'src', output: path.join(tmpDir, '.deepcover-istanbul') });

    const before = runExtractStage({ ...paths, module: 'src', bugs: true });
    const signalsPath = path.join(paths.deepcoverDir, 'bug-signals.json');
    type Signal = { pattern: string; className: string; methodName: string; confidence: number };
    const beforeSignals = JSON.parse(fs.readFileSync(signalsPath, 'utf-8')) as Signal[];
    const beforeSignal = beforeSignals.find(
      (s) => s.pattern === 'unhandled-error-path' && s.className === 'ErrorService' && s.methodName === 'risky',
    );

    // Confidence formula, read from src/bug-detector/detectors/unhandled-error-path.ts
    // calculateConfidence(): base 0.5, +0.1 for throwsErrors (no catch blocks here,
    // so the catchCount term is 0), +0.1 more once Istanbul shows branch coverage < 100%.
    expect(beforeSignal).toBeDefined();
    expect(beforeSignal?.confidence).toBe(0.6);

    // Build an Istanbul fixture keyed to the actual extracted file path (extractCodeModel
    // globs with absolute:true, and resolveCoverage indexes by that exact string) and to
    // the method's real line range, so this doesn't depend on guessing ts-morph's line math.
    const method = before.codeModel.modules[0]!.classes[0]!.methods[0]!;
    const branchLine = method.branches[0]!.lineNumber;
    const istanbulFixture = {
      [before.codeModel.modules[0]!.filePath]: {
        statementMap: {
          '0': { start: { line: method.startLine, column: 0 }, end: { line: method.endLine, column: 1 } },
        },
        s: { '0': 1 },
        branchMap: {
          '0': { loc: { start: { line: branchLine }, end: { line: branchLine } }, type: 'if' },
        },
        // One arm hit, one not: 50% branch coverage, which is < 100%.
        b: { '0': [1, 0] },
        fnMap: {},
        f: {},
      },
    };
    fs.writeFileSync(path.join(paths.deepcoverDir, 'istanbul-coverage.json'), JSON.stringify(istanbulFixture));

    runExtractStage({ ...paths, module: 'src', bugs: true });
    const afterSignals = JSON.parse(fs.readFileSync(signalsPath, 'utf-8')) as Signal[];
    const afterSignal = afterSignals.find(
      (s) => s.pattern === 'unhandled-error-path' && s.className === 'ErrorService' && s.methodName === 'risky',
    );

    expect(afterSignal).toBeDefined();
    expect(afterSignal?.confidence).toBe(0.7);
  });
});
