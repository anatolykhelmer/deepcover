import { assertNoLegacyFlags } from '../legacy-flags';

describe('assertNoLegacyFlags', () => {
  it('passes through a clean argv', () => {
    expect(() => assertNoLegacyFlags(['node', 'cli', 'analyze', '--root', '.'], 'analyze')).not.toThrow();
  });

  it('rejects --no-llm with the replacement command', () => {
    expect(() => assertNoLegacyFlags(['analyze', '--no-llm'], 'analyze')).toThrow(/deepcover run --no-llm/);
  });

  it('rejects --reasoner-input and explains the new default', () => {
    expect(() => assertNoLegacyFlags(['analyze', '--reasoner-input', 'f.json'], 'analyze')).toThrow(
      /read from .deepcover/,
    );
  });

  it('rejects --module on analyze and points at extract', () => {
    expect(() => assertNoLegacyFlags(['analyze', '--module', 'src/x'], 'analyze')).toThrow(
      /deepcover extract --module/,
    );
  });

  it('catches the --flag=value form too', () => {
    expect(() => assertNoLegacyFlags(['analyze', '--module=src/x'], 'analyze')).toThrow(/deepcover extract/);
  });

  it('names the command that was invoked', () => {
    expect(() => assertNoLegacyFlags(['score', '--no-llm'], 'score')).toThrow(/`score`/);
  });
});
