import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePaths } from '../loaders';
import { runExtractStage } from '../extract-stage';
import { runReasonStage } from '../reason-stage';
import { ReasonerOutputSchema } from '../../reasoner/types';
import { MockLLMProvider } from '../../reasoner/providers/mock';
import type { LLMProvider } from '../../reasoner/providers/base';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('runReasonStage', () => {
  let tmpDir: string;
  let deepcoverDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-reason-stage-'));
    deepcoverDir = path.join(tmpDir, '.deepcover');
    const paths = resolvePaths({ root: PROJECT_ROOT, module: FIXTURE, output: deepcoverDir });
    runExtractStage({ ...paths, module: FIXTURE, bugs: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fills every section through a live provider and writes it to disk', async () => {
    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: false,
      reasoner: { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() },
      scope: { module: FIXTURE },
    });

    expect(result.mode).toBe('provider');
    expect(result.output.discoveredStates.length).toBeGreaterThan(0);
    expect(result.output.assertionJudgments.length).toBeGreaterThan(0);

    const onDisk = ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(result.outputPath, 'utf-8')));
    expect(onDisk).toEqual(result.output);
  });

  it('writes an empty template and instructions in agent-template mode', async () => {
    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: false,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
      scope: { module: FIXTURE },
    });

    expect(result.mode).toBe('agent-template');
    expect(result.output.discoveredStates).toEqual([]);
    expect(result.notes.join('\n')).toContain('reasoner-output.json');
    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  /**
   * The agent, not this process, fills the file in agent-template mode, so a
   * re-run of `reason` (or of `run`, which composes it) after the agent has
   * worked must not overwrite it — `extract` already refuses to, and the two
   * stages disagreeing inside one command is how the work got destroyed.
   */
  it('keeps a filled reasoner-output.json instead of overwriting it with a template', async () => {
    const outputPath = path.join(deepcoverDir, 'reasoner-output.json');
    const filled = {
      discoveredStates: [
        {
          className: 'ItemService',
          methodName: 'getById',
          state: 'id not present in the store',
          isTested: false,
          riskIfUntested: 'high',
          confidence: 0.9,
        },
      ],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
    };
    fs.writeFileSync(outputPath, JSON.stringify(filled, null, 2));

    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: false,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
      scope: { module: FIXTURE },
    });

    expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual(filled);
    expect(result.wrote).toBe(false);
    expect(result.output.discoveredStates).toHaveLength(1);
    expect(result.notes.join('\n')).toContain('Kept the existing reasoner-output.json');
    expect(result.notes.join('\n')).not.toContain('Wrote an empty template');
  });

  it('still writes the template when the existing file is only the untouched skeleton', async () => {
    const outputPath = path.join(deepcoverDir, 'reasoner-output.json');
    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: true,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
      scope: { module: FIXTURE },
    });

    expect(result.notes.join('\n')).toContain('Wrote an empty template');
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8')).bugFindings).toEqual({
      findings: [],
      signalValidations: [],
    });
  });

  it('replaces an unparseable reasoner-output.json and says so', async () => {
    const outputPath = path.join(deepcoverDir, 'reasoner-output.json');
    fs.writeFileSync(outputPath, '{ not json');

    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: false,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
      scope: { module: FIXTURE },
    });

    expect(result.notes.join('\n')).toContain('could not be parsed as JSON');
    expect(ReasonerOutputSchema.parse(JSON.parse(fs.readFileSync(outputPath, 'utf-8')))).toEqual(
      result.output,
    );
  });

  it('adds a bugFindings slot to the agent template when bugs are enabled', async () => {
    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: true,
      reasoner: { mode: 'agent-template', providerName: 'cursor' },
      scope: { module: FIXTURE },
    });

    expect(result.output.bugFindings).toEqual({ findings: [], signalValidations: [] });
  });

  it('populates bugFindings from a live provider when bugs are enabled', async () => {
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

    const result = await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: true,
      reasoner: { mode: 'provider', providerName: 'mock', provider: new MockLLMProvider() },
      scope: { module: FIXTURE },
    });

    expect(result.output.bugFindings).toBeDefined();
    expect(result.output.bugFindings!.findings.length).toBeGreaterThan(0);
  });

  it('fails with a hint when the code model has not been extracted', async () => {
    fs.rmSync(path.join(deepcoverDir, 'code-model.json'));
    await expect(
      runReasonStage({
        rootDir: PROJECT_ROOT,
        deepcoverDir,
        bugs: false,
        reasoner: { mode: 'agent-template', providerName: 'cursor' },
        scope: { module: FIXTURE },
      }),
    ).rejects.toThrow(/deepcover extract/);
  });

  // The given tests above only prove `mode` and array lengths. Neither pins that
  // Istanbul coverage and the exact bug-signal evidence supplied on disk are the
  // material that actually reaches the provider — a swapped/omitted argument in
  // runReasonStage's call to runReasoner would not fail any of them. These two
  // tests record the raw prompt strings sent to a fake provider and assert on
  // their content instead of trusting the mock's canned, input-independent output.

  it('passes istanbulCoverage through to the criticality prompt sent to the provider', async () => {
    const rootDir = path.join(tmpDir, 'istanbul-proj');
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    // `if (flag)` gives Istanbul a branch to under-cover, mirroring the fixture
    // extract-stage.spec.ts uses to pin the same Istanbul call site.
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

    const istanbulPaths = resolvePaths({
      root: rootDir,
      module: 'src',
      output: path.join(tmpDir, '.deepcover-istanbul'),
    });
    const extracted = runExtractStage({ ...istanbulPaths, module: 'src', bugs: false });

    // Istanbul fixture keyed to the actual extracted file path and method line
    // range, so this doesn't depend on guessing ts-morph's line math.
    const method = extracted.codeModel.modules[0]!.classes[0]!.methods[0]!;
    const branchLine = method.branches[0]!.lineNumber;
    const istanbulFixture = {
      [extracted.codeModel.modules[0]!.filePath]: {
        statementMap: {
          '0': { start: { line: method.startLine, column: 0 }, end: { line: method.endLine, column: 1 } },
        },
        s: { '0': 1 },
        branchMap: {
          '0': { loc: { start: { line: branchLine }, end: { line: branchLine } }, type: 'if' },
        },
        // One arm hit, one not: 50% branch coverage.
        b: { '0': [1, 0] },
        fnMap: {},
        f: {},
      },
    };
    fs.writeFileSync(
      path.join(istanbulPaths.deepcoverDir, 'istanbul-coverage.json'),
      JSON.stringify(istanbulFixture),
    );

    const recordedCriticalityPrompts: string[] = [];
    const recordingProvider: LLMProvider = {
      async analyze(system: string, user: string): Promise<string> {
        if (system.toLowerCase().includes('business criticality')) {
          recordedCriticalityPrompts.push(user);
        }
        return '[]';
      },
    };

    await runReasonStage({
      rootDir,
      deepcoverDir: istanbulPaths.deepcoverDir,
      bugs: false,
      reasoner: { mode: 'provider', providerName: 'mock', provider: recordingProvider },
      scope: { module: 'src' },
    });

    expect(recordedCriticalityPrompts).toHaveLength(1);
    const parsedUser = JSON.parse(recordedCriticalityPrompts[0]!) as {
      classes: Array<{ methods: Array<{ name: string; branchCoveragePercent?: number }> }>;
    };
    const riskyMethod = parsedUser.classes[0]!.methods.find((m) => m.name === 'risky');
    expect(riskyMethod?.branchCoveragePercent).toBe(50);
  });

  it('sends the exact bug-signal evidence written to bug-signals.json to the provider', async () => {
    fs.writeFileSync(
      path.join(deepcoverDir, 'bug-signals.json'),
      JSON.stringify([
        {
          pattern: 'unhandled-error-path',
          className: 'ItemService',
          methodName: 'create',
          evidence: 'this-exact-string-must-reach-the-prompt',
          sourceLocation: { file: '/src/item.service.ts', line: 1 },
          confidence: 0.7,
        },
      ]),
    );

    const recordedBugPrompts: string[] = [];
    const recordingProvider: LLMProvider = {
      async analyze(system: string, user: string): Promise<string> {
        if (system.toLowerCase().includes('bug signal') || system.toLowerCase().includes('potential bugs')) {
          recordedBugPrompts.push(user);
          return JSON.stringify({ findings: [], signalValidations: [] });
        }
        return '[]';
      },
    };

    await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir,
      bugs: true,
      reasoner: { mode: 'provider', providerName: 'mock', provider: recordingProvider },
      scope: { module: FIXTURE },
    });

    expect(recordedBugPrompts).toHaveLength(1);
    expect(recordedBugPrompts[0]).toContain('this-exact-string-must-reach-the-prompt');
  });
});
