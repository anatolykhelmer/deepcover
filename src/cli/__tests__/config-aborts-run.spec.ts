import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI = 'npx tsx src/cli/index.ts';
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

/**
 * An invalid config must stop every command before it does any work — the
 * point of throwing rather than warning. `extract` is the sharpest case: it
 * used to read the config only at the very end, to pick a "Next:" hint, so a
 * late failure would have aborted after the artifacts were already written.
 */
describe('an invalid config aborts the run', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-badconfig-'));
    fs.writeFileSync(
      path.join(tmpDir, 'deepcover.config.json'),
      JSON.stringify({ resoner: { provider: 'mock' } }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(command: string): { status: number; output: string } {
    try {
      const output = execSync(`${CLI} ${command} --root ${tmpDir} 2>&1`, {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT,
      });
      return { status: 0, output };
    } catch (err) {
      const e = err as { status: number; stdout: string };
      return { status: e.status, output: e.stdout };
    }
  }

  for (const command of ['extract', 'reason', 'analyze']) {
    it(`${command} exits non-zero and names the bad key`, () => {
      const { status, output } = run(command);
      expect(status).not.toBe(0);
      expect(output).toContain('resoner');
      expect(output).toContain('Invalid config');
    });

    it(`${command} reports the error without a stack trace`, () => {
      const { output } = run(command);
      expect(output).not.toContain('at Object.');
      expect(output).not.toContain('ConfigError:');
    });
  }

  it('extract writes no artifacts when the config is invalid', () => {
    const { status } = run(`extract --module ${FIXTURE}`);
    expect(status).not.toBe(0);
    // The whole point of loading config up front: nothing should exist yet.
    expect(fs.existsSync(path.join(tmpDir, '.deepcover'))).toBe(false);
  });

  it('extract still succeeds when the config is valid', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'deepcover.config.json'),
      JSON.stringify({ reasoner: { provider: 'mock' } }),
    );
    const { status } = run(`extract --module ${FIXTURE}`);
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, '.deepcover', 'code-model.json'))).toBe(true);
  });
});
