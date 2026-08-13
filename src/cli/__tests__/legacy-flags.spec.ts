import { assertNoLegacyFlags } from '../legacy-flags';
import { analyzeCommand } from '../commands/analyze';

describe('assertNoLegacyFlags', () => {
  it('passes through clean options', () => {
    expect(() => assertNoLegacyFlags({ llm: true }, 'analyze')).not.toThrow();
  });

  it('passes when llm is undefined (not every caller sets Commander defaults)', () => {
    expect(() => assertNoLegacyFlags({}, 'analyze')).not.toThrow();
  });

  it('rejects --no-llm (llm: false) with the replacement command', () => {
    expect(() => assertNoLegacyFlags({ llm: false }, 'analyze')).toThrow(/deepcover run --no-llm/);
  });

  it('rejects --reasoner-input and explains the new default', () => {
    expect(() => assertNoLegacyFlags({ reasonerInput: 'f.json' }, 'analyze')).toThrow(/read from .deepcover/);
  });

  it('rejects --module on analyze and points at extract', () => {
    expect(() => assertNoLegacyFlags({ module: 'src/x' }, 'analyze')).toThrow(/deepcover extract --module/);
  });

  it('rejects --file and points at extract', () => {
    expect(() => assertNoLegacyFlags({ file: 'src/x.ts' }, 'analyze')).toThrow(/deepcover extract --file/);
  });

  it('names the command that was invoked', () => {
    expect(() => assertNoLegacyFlags({ llm: false }, 'score')).toThrow(/`score`/);
  });
});

/**
 * Regression: the guard used to scan `process.argv`, which only reflects how the
 * *host process* was launched. A command driven in-process — `parseAsync(argv, {
 * from: 'user' })`, exactly what `llm-scope.spec.ts` already does, and what Task
 * 10's `run` command may do — never touches `process.argv`, so an argv scan let
 * removed flags through silently instead of raising the migration hint. Only an
 * in-process invocation like this one can catch that; the option-object unit
 * tests above cannot, because they never go through Commander's parser at all.
 */
describe('assertNoLegacyFlags reaches in-process invocations', () => {
  it('surfaces the migration error when analyze is driven via parseAsync, not a subprocess', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitCodeBefore = process.exitCode;

    await analyzeCommand.parseAsync(['--root', '.', '--module', 'fixtures/assertion-quality'], { from: 'user' });

    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toMatch(/deepcover extract --module/);

    errorSpy.mockRestore();
    process.exitCode = exitCodeBefore;
  });
});
