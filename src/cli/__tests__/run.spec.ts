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
