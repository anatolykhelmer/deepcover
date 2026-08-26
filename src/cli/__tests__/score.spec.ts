import { spawnSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

describe('score command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-score-'));
    execSync(
      `npx tsx src/cli/index.ts extract --root ${PROJECT_ROOT} --module ${FIXTURE} --output ${path.join(tmpDir, '.deepcover')}`,
      { encoding: 'utf-8', cwd: PROJECT_ROOT },
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runScore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const tsxCli = require.resolve('tsx/cli');
    const result = spawnSync(
      process.execPath,
      [tsxCli, 'src/cli/index.ts', 'score', '--root', tmpDir, ...args],
      {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT,
        env: { ...process.env, NODE_OPTIONS: undefined, NPM_CONFIG_LOGLEVEL: 'error' },
      },
    );
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? -1 };
  }

  function writeConfig(config: unknown): void {
    fs.writeFileSync(path.join(tmpDir, 'deepcover.config.json'), JSON.stringify(config));
  }

  function parseScore(stdout: string): number {
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(lines[i]!)) return parseInt(lines[i]!, 10);
    }
    return NaN;
  }

  it('outputs a number and nothing else on stdout', () => {
    const { stdout, stderr, exitCode } = runScore([]);
    const num = parseScore(stdout);
    if (!Number.isInteger(num)) {
      throw new Error(
        `expected an integer on stdout, got ${JSON.stringify(stdout)} (exit ${exitCode}, stderr=${JSON.stringify(stderr.slice(0, 500))})`,
      );
    }
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  it('exits 1 when the score is below --min-score', () => {
    expect(runScore(['--min-score', '100']).exitCode).toBe(1);
  });

  it('exits 0 when the score meets --min-score', () => {
    expect(runScore(['--min-score', '0']).exitCode).toBe(0);
  });

  it('gates on thresholds.composite from the config when no flag is given', () => {
    // 100 is above any score this fixture reaches, so the gate must fire.
    writeConfig({ thresholds: { composite: 100 } });
    expect(runScore([]).exitCode).toBe(1);
  });

  it('lets the flag override a config threshold', () => {
    writeConfig({ thresholds: { composite: 100 } });
    expect(runScore(['--min-score', '0']).exitCode).toBe(0);
  });

  it('does not gate when neither flag nor config sets a threshold', () => {
    writeConfig({ reasoner: { provider: 'mock' } });
    expect(runScore([]).exitCode).toBe(0);
  });

  it('gates on the flag when there is no config threshold', () => {
    writeConfig({ reasoner: { provider: 'mock' } });
    expect(runScore(['--min-score', '100']).exitCode).toBe(1);
  });

  /**
   * Now that the flag suppresses a configured threshold, a flag that does not
   * parse must stop the run rather than degrade to "no gate": silently dropping
   * a gate the repo asked for reports a failing build as passing. `parseInt`
   * alone is not enough — it reads '8O' as 8 and gates at 8.
   */
  it('rejects a malformed --min-score instead of silently dropping the config gate', () => {
    writeConfig({ thresholds: { composite: 100 } });
    const { exitCode, stderr } = runScore(['--min-score', '8O']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--min-score expects a number, got '8O'");
  });
});
