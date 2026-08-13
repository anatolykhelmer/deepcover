import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPipeline } from '../run-pipeline';
import { MockLLMProvider } from '../../reasoner/providers/mock';
import * as analyzeStageModule from '../analyze-stage';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('runPipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-run-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs all three stages with a live provider and returns a score', async () => {
    const result = await runPipeline({
      root: PROJECT_ROOT,
      module: FIXTURE,
      output: path.join(tmpDir, '.deepcover'),
      bugs: false,
      llm: true,
      reasoner: { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() },
    });

    expect(result.stoppedAfterReason).toBe(false);
    expect(result.score!.composite).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'))).toBe(true);
  });

  it('stops after the reason stage in agent-template mode', async () => {
    // Pin that scoring genuinely never ran — not merely that `score` came back
    // undefined, which a bug that ran analyze but forgot to attach the result
    // would also satisfy.
    const analyzeSpy = jest.spyOn(analyzeStageModule, 'runAnalyzeStage');

    const result = await runPipeline({
      root: PROJECT_ROOT,
      module: FIXTURE,
      output: path.join(tmpDir, '.deepcover'),
      bugs: false,
      llm: true,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
    });

    expect(result.stoppedAfterReason).toBe(true);
    expect(result.score).toBeUndefined();
    expect(result.notes.join('\n')).toContain('deepcover analyze');
    expect(analyzeSpy).not.toHaveBeenCalled();

    analyzeSpy.mockRestore();
  });

  it('skips the reason stage entirely with llm: false', async () => {
    const result = await runPipeline({
      root: PROJECT_ROOT,
      module: FIXTURE,
      output: path.join(tmpDir, '.deepcover'),
      bugs: false,
      llm: false,
      reasoner: { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() },
    });

    expect(result.stoppedAfterReason).toBe(false);
    expect(result.score).toBeDefined();
    // The extract stage seeds an empty template; nothing filled it.
    const output = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8'),
    );
    expect(output.discoveredStates).toEqual([]);
    // Pin that the reason stage itself never ran (not just that the template
    // happens to still be empty): the mock provider would have logged a note
    // naming itself as the reasoner, and `--no-llm` takes the deterministic-only
    // note path instead.
    expect(result.notes.join('\n')).not.toContain('Reasoner: mock');
    expect(result.notes.join('\n')).toContain('Skipped the reason stage');
  });

  it('produces hybrid bug findings end to end with --bugs and a provider', async () => {
    // This is task 023's acceptance case: bugFindings must reach potentialBugs.
    const result = await runPipeline({
      root: PROJECT_ROOT,
      module: FIXTURE,
      output: path.join(tmpDir, '.deepcover'),
      bugs: true,
      llm: true,
      reasoner: { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() },
    });

    const reasonerOutput = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.deepcover', 'reasoner-output.json'), 'utf-8'),
    );
    expect(reasonerOutput.bugFindings.findings.length).toBeGreaterThan(0);

    // Deterministic detectors alone could make potentialBugs non-empty even if
    // the LLM half were silently dropped — the exact bug this test guards
    // against (analyze/score used to call the reasoner with undefined signals,
    // so the LLM job never ran). Assert on the specific LLM-originated finding
    // MockLLMProvider returns for ItemService.create, distinguishable in
    // potentialBugs by `source: 'llm'` (see src/bug-merger/index.ts).
    const llmBug = result.score!.potentialBugs.find(
      (bug) =>
        bug.source === 'llm' &&
        bug.className === 'ItemService' &&
        bug.methodName === 'create' &&
        bug.description === 'Validation not asserted',
    );
    expect(llmBug).toBeDefined();
  });
});
