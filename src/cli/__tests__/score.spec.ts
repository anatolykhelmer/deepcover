import { spawnSync } from 'child_process';
import path from 'path';

const FIXTURE = 'fixtures/assertion-quality';

function runScore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const root = path.resolve(__dirname, '../../..');
  // Avoid `npx` — npm may emit warnings on stdout and break numeric parsing.
  const tsxCli = require.resolve('tsx/cli');
  const result = spawnSync(
    process.execPath,
    [tsxCli, 'src/cli/index.ts', 'score', '--root', root, '--module', FIXTURE, ...args],
    {
      encoding: 'utf-8',
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: undefined,
        NPM_CONFIG_LOGLEVEL: 'error',
      },
    },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? -1,
  };
}

/** Last line that is only an integer (the score command's contract). */
function parseScore(stdout: string): number {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(lines[i]!)) {
      return parseInt(lines[i]!, 10);
    }
  }
  return NaN;
}

describe('score command', () => {
  it('outputs a number', () => {
    const { stdout, stderr, exitCode } = runScore(['--no-llm']);
    const num = parseScore(stdout);
    if (!Number.isInteger(num)) {
      throw new Error(
        `expected integer score on stdout, got ${JSON.stringify(stdout)} (exit ${exitCode}, stderr=${JSON.stringify(stderr.slice(0, 500))})`,
      );
    }
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  it('exits with code 1 when score < min-score', () => {
    const { exitCode } = runScore(['--no-llm', '--min-score', '100']);
    expect(exitCode).toBe(1);
  });

  it('exits with code 0 when score >= min-score', () => {
    const { exitCode } = runScore(['--no-llm', '--min-score', '0']);
    expect(exitCode).toBe(0);
  });
});
