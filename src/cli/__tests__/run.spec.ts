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
});
