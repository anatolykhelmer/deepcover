import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const tsxCli = require.resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsxCli, 'src/cli/index.ts', ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_OPTIONS: undefined, NPM_CONFIG_LOGLEVEL: 'error' },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? -1 };
}

describe('run command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-run-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces a terminal report in one shot with --no-llm', () => {
    const { stdout, exitCode } = runCli([
      'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
      '--no-llm', '--output', path.join(tmpDir, '.deepcover'),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Composite Score');
  });

  it('prints only a number on stdout with --format score, matching the terminal composite', () => {
    // Cross-check against the terminal report's own "Composite Score: N/100" line — both
    // come from the same result.score.composite, so the two independent formatters must agree.
    const terminal = runCli([
      'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
      '--no-llm', '--output', path.join(tmpDir, '.deepcover'),
    ]);
    const match = terminal.stdout.match(/Composite Score: (\d+)\/100/);
    expect(match).not.toBeNull();
    const expectedComposite = match![1];

    const { stdout, exitCode } = runCli([
      'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
      '--no-llm', '--format', 'score', '--output', path.join(tmpDir, '.deepcover'),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(expectedComposite);
  });

  it('keeps notes off stdout so CI can parse the score', () => {
    const { stdout, stderr } = runCli([
      'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
      '--no-llm', '--format', 'score', '--output', path.join(tmpDir, '.deepcover'),
    ]);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(stderr).toContain('reason');
  });

  it('exits 1 when the score is below --min-score', () => {
    const { exitCode } = runCli([
      'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
      '--no-llm', '--min-score', '100', '--output', path.join(tmpDir, '.deepcover'),
    ]);
    expect(exitCode).toBe(1);
  });

  /**
   * A bad `--min-score` must be caught before the pipeline runs, not after.
   * `run` extracts, calls the reasoner, and prints the whole report before it
   * reaches the gate, so a check at the gate site would reject the flag only
   * after the expensive work was done and success was already on stdout.
   */
  describe('--min-score is validated before any work', () => {
    it.each([
      ['8O', 'unparseable'],
      ['-5', 'out of range'],
    ])('rejects %p (%s) with no report on stdout and no artifacts written', (flag) => {
      const outDir = path.join(tmpDir, '.deepcover');

      const { stdout, stderr, exitCode } = runCli([
        'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
        '--no-llm', '--min-score', flag, '--output', outDir,
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(`got '${flag}'`);
      // The report never printed — the whole point of failing early.
      expect(stdout.trim()).toBe('');
      expect(stdout).not.toContain('Composite Score');
      // The extract stage mkdirs this directory as its first act, so its absence
      // proves the pipeline never started rather than merely printing nothing.
      expect(fs.existsSync(outDir)).toBe(false);
    });

    it('does the work and prints the report when the same flag is valid', () => {
      // Guards the assertions above against passing for the wrong reason: this
      // invocation differs only in the flag's value.
      const outDir = path.join(tmpDir, '.deepcover');

      const { stdout, exitCode } = runCli([
        'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
        '--no-llm', '--min-score', '0', '--output', outDir,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Composite Score');
      expect(fs.existsSync(outDir)).toBe(true);
    });
  });

  /**
   * `run` resolves the composite gate at its own call site, separate from the one
   * `analyze`/`score` share. Nothing else in the suite exercises it, so this is
   * where a lost config fallback would go unnoticed.
   */
  describe('composite threshold from config', () => {
    let root: string;

    beforeEach(() => {
      // Own root, not PROJECT_ROOT: the repo's own config sets thresholds.composite,
      // which would otherwise decide the outcome of these tests.
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-run-threshold-'));
      fs.cpSync(path.join(PROJECT_ROOT, FIXTURE), path.join(root, 'module'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    function runWithConfig(config: unknown, args: string[]): number {
      fs.writeFileSync(path.join(root, 'deepcover.config.json'), JSON.stringify(config));
      return runCli([
        'run', '--root', root, '--module', 'module',
        '--no-llm', '--output', path.join(root, '.deepcover'), ...args,
      ]).exitCode;
    }

    it('gates on thresholds.composite when no flag is given', () => {
      // 100 is above any score this fixture reaches, so the gate must fire.
      expect(runWithConfig({ thresholds: { composite: 100 } }, [])).toBe(1);
    });

    it('lets the flag override a config threshold', () => {
      expect(runWithConfig({ thresholds: { composite: 100 } }, ['--min-score', '0'])).toBe(0);
    });

    it('does not gate when neither flag nor config sets a threshold', () => {
      expect(runWithConfig({ reasoner: { provider: 'mock' } }, [])).toBe(0);
    });
  });

  // Pins the direction of `highRisk >= threshold` and its `&& options.bugs` guard in
  // run.ts:160-167 — an inverted comparison or `&&` becoming `||` must fail these.
  describe('--bug-threshold gate', () => {
    it('exits 1 at threshold 0 with --bugs (any high-risk count satisfies >= 0)', () => {
      const { exitCode } = runCli([
        'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
        '--no-llm', '--bugs', '--bug-threshold', '0', '--output', path.join(tmpDir, '.deepcover'),
      ]);
      expect(exitCode).toBe(1);
    });

    it('exits 0 at a threshold above the actual high-risk count', () => {
      const { exitCode } = runCli([
        'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
        '--no-llm', '--bugs', '--bug-threshold', '999', '--output', path.join(tmpDir, '.deepcover'),
      ]);
      expect(exitCode).toBe(0);
    });

    it('does not fire without --bugs, even at threshold 0', () => {
      const { exitCode } = runCli([
        'run', '--root', PROJECT_ROOT, '--module', FIXTURE,
        '--no-llm', '--bug-threshold', '0', '--output', path.join(tmpDir, '.deepcover'),
      ]);
      expect(exitCode).toBe(0);
    });
  });

  it('stops after the reason stage in agent-template mode: exit 0, notes on stderr, no report on stdout', () => {
    // Drives the real config -> resolveReasoner path (not a hand-built ResolvedReasoner):
    // a fresh root with its own deepcover.config.json selecting the 'cursor' provider,
    // which resolveReasoner maps to agent-template mode.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-run-agent-template-'));
    try {
      fs.cpSync(path.join(PROJECT_ROOT, FIXTURE), path.join(root, 'module'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'deepcover.config.json'),
        JSON.stringify({ reasoner: { provider: 'cursor' } }),
      );

      const { stdout, stderr, exitCode } = runCli([
        'run', '--root', root, '--module', 'module', '--output', path.join(root, '.deepcover'),
      ]);

      expect(exitCode).toBe(0);
      // The agent-template note names the provider and explains the handoff — this is
      // what a caller relies on to know scoring did not happen yet.
      expect(stderr).toContain('Reasoner: cursor (your coding agent).');
      // The regression this guards against: an early-return reordered after scoring,
      // which would leak a composite score or JSON report onto stdout.
      expect(stdout.trim()).toBe('');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
