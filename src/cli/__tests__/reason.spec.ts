import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ReasonerOutputSchema } from '../../reasoner/types';

const CLI = 'npx tsx src/cli/index.ts';
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('reason command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-reason-'));
    fs.writeFileSync(
      path.join(tmpDir, 'deepcover.config.json'),
      JSON.stringify({ reasoner: { provider: 'mock' } }),
    );
    execSync(
      `${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${path.join(tmpDir, '.deepcover')}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a Zod-valid reasoner-output from the extracted model', () => {
    execSync(`${CLI} reason --root ${tmpDir} --module ${FIXTURE}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    const parsed = ReasonerOutputSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8')),
    );
    expect(parsed.discoveredStates.length).toBeGreaterThan(0);
    expect(parsed.assertionJudgments.length).toBeGreaterThan(0);
    expect(parsed.criticalityRatings.length).toBeGreaterThan(0);
    expect(parsed.transitiveInferences.length).toBeGreaterThan(0);
  });

  it('judges only tests inside the module the extract was scoped to', () => {
    execSync(`${CLI} reason --root ${tmpDir} --module ${FIXTURE}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    const parsed = ReasonerOutputSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8')),
    );
    const prompts = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.deepcover', 'prompts.json'), 'utf-8'),
    );
    const promptTestFiles = JSON.parse(prompts.assertionQuality.user).testFiles as Array<{
      describes: Array<{ tests: Array<{ name: string }> }>;
    }>;
    const expected = new Set(
      promptTestFiles.flatMap((tf) => tf.describes.flatMap((d) => d.tests.map((t) => t.name))),
    );

    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(parsed.assertionJudgments.map((j) => j.testName))).toEqual(expected);
  });

  it('writes a template instead of calling an LLM when the agent is the Reasoner', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'deepcover.config.json'),
      JSON.stringify({ reasoner: { provider: 'cursor' } }),
    );
    const stdout = execSync(`${CLI} reason --root ${tmpDir} --module ${FIXTURE}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8'),
    );
    expect(parsed.discoveredStates).toEqual([]);
    expect(stdout).toContain('reasoner-output.json');
  });

  /**
   * `--code-model` forces `scope = {}` — it cannot know whether the supplied
   * model is whole-repo — which silently overrides `--module`/`--file`. The
   * warning is the only thing telling the user those flags did nothing.
   */
  it('reasons from an explicit --code-model and warns that --module is ignored', () => {
    const modelPath = path.join(tmpDir, 'moved-code-model.json');
    fs.copyFileSync(path.join(tmpDir, '.deepcover', 'code-model.json'), modelPath);

    const stderr = execSync(
      `${CLI} reason --root ${tmpDir} --module ${FIXTURE} --code-model ${modelPath} 2>&1 >/dev/null`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT, shell: '/bin/bash' },
    );

    expect(stderr).toContain('`--code-model` set; ignoring `--module`/`--file`');

    const parsed = ReasonerOutputSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8')),
    );
    expect(parsed.discoveredStates.length).toBeGreaterThan(0);
    expect(parsed.assertionJudgments.length).toBeGreaterThan(0);
  });

  it('does not warn about --module/--file when --code-model is used alone', () => {
    const modelPath = path.join(tmpDir, 'moved-code-model.json');
    fs.copyFileSync(path.join(tmpDir, '.deepcover', 'code-model.json'), modelPath);

    const stderr = execSync(`${CLI} reason --root ${tmpDir} --code-model ${modelPath} 2>&1 >/dev/null`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      shell: '/bin/bash',
    });

    expect(stderr).not.toContain('ignoring');
  });

  it('exits non-zero when the code model is missing', () => {
    fs.rmSync(path.join(tmpDir, '.deepcover', 'code-model.json'));
    expect(() =>
      execSync(`${CLI} reason --root ${tmpDir}`, {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('--bugs populates bugFindings', () => {
    execSync(`${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --bugs --output ${path.join(tmpDir, '.deepcover')}`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    execSync(`${CLI} reason --root ${tmpDir} --module ${FIXTURE} --bugs`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    const parsed = ReasonerOutputSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8')),
    );
    expect(parsed.bugFindings).toBeDefined();
  });
});
