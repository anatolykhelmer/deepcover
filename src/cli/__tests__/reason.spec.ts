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
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes Zod-valid reasoner-output from --module extract path', () => {
    const out = path.join(tmpDir, 'reasoner-output.json');
    execSync(
      `${CLI} reason --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${out}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const parsed = ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(out, 'utf-8')));
    expect(parsed.discoveredStates.length).toBeGreaterThan(0);
    expect(parsed.assertionJudgments.length).toBeGreaterThan(0);
    expect(parsed.criticalityRatings.length).toBeGreaterThan(0);
    expect(parsed.transitiveInferences.length).toBeGreaterThan(0);
  });

  it('judges only tests inside --module, not the whole project', () => {
    const out = path.join(tmpDir, 'reasoner-output.json');
    execSync(
      `${CLI} reason --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${out}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const parsed = ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(out, 'utf-8')));

    // extract already scopes prompts to the module — reason must agree with it.
    execSync(
      `${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${tmpDir}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const prompts = JSON.parse(fs.readFileSync(path.join(tmpDir, 'prompts.json'), 'utf-8'));
    const promptTestFiles = JSON.parse(prompts.assertionQuality.user).testFiles as Array<{
      describes: Array<{ tests: Array<{ name: string }> }>;
    }>;
    const expected = new Set(
      promptTestFiles.flatMap((tf) => tf.describes.flatMap((d) => d.tests.map((t) => t.name))),
    );

    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(parsed.assertionJudgments.map((j) => j.testName))).toEqual(expected);
  });

  it('loads --code-model without needing --module', () => {
    execSync(
      `${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${tmpDir}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const codeModelPath = path.join(tmpDir, 'code-model.json');
    const out = path.join(tmpDir, 'from-model.json');
    execSync(
      `${CLI} reason --root ${PROJECT_ROOT} --code-model ${codeModelPath} --output ${out}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    expect(() => ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(out, 'utf-8')))).not.toThrow();
  });

  it('exits non-zero when --code-model path is missing', () => {
    const missing = path.join(tmpDir, 'nope.json');
    expect(() =>
      execSync(
        `${CLI} reason --root ${PROJECT_ROOT} --code-model ${missing} --output ${path.join(tmpDir, 'o.json')}`,
        { encoding: 'utf-8', cwd: PROJECT_ROOT, stdio: 'pipe' },
      ),
    ).toThrow();
  });

  it('--bugs populates bugFindings', () => {
    execSync(
      `${CLI} extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${tmpDir}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const codeModelPath = path.join(tmpDir, 'code-model.json');
    const deepcoverDir = path.join(tmpDir, '.deepcover');
    fs.mkdirSync(deepcoverDir, { recursive: true });
    fs.writeFileSync(
      path.join(deepcoverDir, 'bug-signals.json'),
      JSON.stringify([
        {
          pattern: 'unhandled-error-path',
          className: 'ItemService',
          methodName: 'create',
          evidence: 'throws without test',
          sourceLocation: { file: '/src/item.service.ts', line: 1 },
          confidence: 0.7,
        },
      ]),
    );
    const out = path.join(tmpDir, 'with-bugs.json');
    execSync(
      `${CLI} reason --root ${tmpDir} --code-model ${codeModelPath} --output ${out} --bugs`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
    const parsed = ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(out, 'utf-8')));
    expect(parsed.bugFindings).toBeDefined();
  });
});
