import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePaths } from '../../pipeline/loaders';
import { runExtractStage } from '../../pipeline/extract-stage';
import { runReasonStage } from '../../pipeline/reason-stage';
import type { LLMProvider } from '../../reasoner/providers/base';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

/** Test files that exist in this repo but belong to no part of the fixture module. */
const OUT_OF_SCOPE = [
  'fixtures/standalone-functions/source.spec.ts',
  'src/reasoner/__tests__/reasoner.spec.ts',
  'src/scorer/__tests__',
];

describe('module-scoped reasoner runs', () => {
  let tmpDir: string;
  let prompts: Array<{ system: string; user: string }>;
  let provider: LLMProvider;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-scope-'));
    prompts = [];
    provider = {
      analyze: async (system: string, user: string) => {
        prompts.push({ system, user });
        return '[]';
      },
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function promptedFiles(): string[] {
    return prompts.flatMap((p) => {
      let parsed: { testFiles?: Array<{ filePath: string }> };
      try {
        parsed = JSON.parse(p.user);
      } catch {
        return [];
      }
      return (parsed.testFiles ?? []).map((tf) => path.relative(PROJECT_ROOT, tf.filePath));
    });
  }

  async function reasonOver(scopeFlags: { module?: string; file?: string }): Promise<void> {
    const paths = resolvePaths({
      root: PROJECT_ROOT,
      ...scopeFlags,
      output: path.join(tmpDir, '.deepcover'),
    });
    runExtractStage({ ...paths, ...scopeFlags, bugs: false });
    await runReasonStage({
      rootDir: PROJECT_ROOT,
      deepcoverDir: paths.deepcoverDir,
      bugs: false,
      reasoner: { mode: 'provider', providerName: 'mock', provider },
      scope: {
        ...(scopeFlags.module && { module: scopeFlags.module }),
        wholeRepo: !scopeFlags.module && !scopeFlags.file,
      },
    });
  }

  it('sends only the module under analysis to the Reasoner', async () => {
    await reasonOver({ module: FIXTURE });

    const files = promptedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith(FIXTURE))).toBe(true);
    for (const outsider of OUT_OF_SCOPE) {
      expect(files.filter((f) => f.startsWith(outsider))).toEqual([]);
    }
  });

  it('scopes to a single file, not the repository', async () => {
    await reasonOver({ file: `${FIXTURE}/source.ts` });
    expect(promptedFiles().every((f) => f.startsWith(FIXTURE))).toBe(true);
  });
});
