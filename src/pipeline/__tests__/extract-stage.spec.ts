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
    const rootCopy = path.join(tmpDir, 'proj');
    fs.mkdirSync(path.join(rootCopy, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(rootCopy, 'src', 'thing.ts'),
      'export class Thing { run(): number { return 1; } }\n',
    );

    const paths = resolvePaths({ root: rootCopy, module: 'src' });
    runExtractStage({ ...paths, module: 'src', bugs: false });

    expect(fs.existsSync(path.join(rootCopy, '.deepcover', 'code-model.json'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), '.deepcover', 'code-model.json'))).toBe(false);
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
});
