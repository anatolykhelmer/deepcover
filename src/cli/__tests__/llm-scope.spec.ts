import path from 'path';

/**
 * `analyze --module X` and `score --module X` run the Reasoner by default
 * (`--no-llm` opts out), building prompts from a CodeModel whose test inventory
 * is repository-wide — so both must scope it before the Reasoner sees it. Run
 * in-process against a provider that records what it was asked, since the
 * prompts never reach stdout.
 */
const mockPrompts: Array<{ system: string; user: string }> = [];

jest.mock('../resolve-provider', () => ({
  resolveLLMProvider: () => ({
    analyze: async (system: string, user: string) => {
      mockPrompts.push({ system, user });
      return '[]';
    },
  }),
}));

import { analyzeCommand } from '../commands/analyze';
import { scoreCommand } from '../commands/score';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

/** Test files that exist in this repo but belong to no part of the fixture module. */
const OUT_OF_SCOPE = [
  'fixtures/standalone-functions/source.spec.ts',
  'src/reasoner/__tests__/reasoner.spec.ts',
  'src/scorer/__tests__',
];

/** Every test file path across all prompts the run sent, relative to the root. */
function promptedFiles(): string[] {
  return mockPrompts.flatMap((p) => {
    let parsed: { testFiles?: Array<{ filePath: string }> };
    try {
      parsed = JSON.parse(p.user);
    } catch {
      return []; // a prompt that carries no JSON payload carries no test files
    }
    return (parsed.testFiles ?? []).map((tf) => path.relative(PROJECT_ROOT, tf.filePath));
  });
}

describe('module-scoped --llm runs', () => {
  let exitCode: typeof process.exitCode;

  beforeEach(() => {
    mockPrompts.length = 0;
    exitCode = process.exitCode;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = exitCode;
  });

  it('analyze sends only the module under analysis to the Reasoner', async () => {
    await analyzeCommand.parseAsync(
      ['--root', PROJECT_ROOT, '--module', FIXTURE, '--format', 'json'],
      { from: 'user' },
    );

    const files = promptedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith(FIXTURE))).toBe(true);
    for (const outsider of OUT_OF_SCOPE) {
      expect(files.filter((f) => f.startsWith(outsider))).toEqual([]);
    }
  });

  it('score sends only the module under analysis to the Reasoner', async () => {
    await scoreCommand.parseAsync(
      ['--root', PROJECT_ROOT, '--module', FIXTURE],
      { from: 'user' },
    );

    const files = promptedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith(FIXTURE))).toBe(true);
  });

  it('analyze --file scopes the Reasoner to that file, not the repository', async () => {
    await analyzeCommand.parseAsync(
      ['--root', PROJECT_ROOT, '--file', `${FIXTURE}/source.ts`, '--format', 'json'],
      { from: 'user' },
    );

    const files = promptedFiles();
    expect(files.every((f) => f.startsWith(FIXTURE))).toBe(true);
  });
});
