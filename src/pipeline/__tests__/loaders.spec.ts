import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolvePaths,
  loadJestArtifacts,
  loadReasonerOutputFile,
  loadCodeModelFile,
  EMPTY_REASONER_OUTPUT,
} from '../loaders';

describe('pipeline loaders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-loaders-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolvePaths', () => {
    it('defaults the artifact dir to <root>/.deepcover, not CWD', () => {
      const { rootDir, deepcoverDir } = resolvePaths({ root: tmpDir });
      expect(rootDir).toBe(fs.realpathSync(tmpDir));
      expect(deepcoverDir).toBe(path.join(fs.realpathSync(tmpDir), '.deepcover'));
    });

    it('honours an explicit output dir as the user typed it', () => {
      const explicit = path.join(tmpDir, 'custom-out');
      const { deepcoverDir } = resolvePaths({ root: tmpDir, output: explicit });
      expect(deepcoverDir).toBe(path.resolve(explicit));
    });

    it('turns --module into a glob and --file into a single include', () => {
      expect(resolvePaths({ root: tmpDir, module: 'src/orders/' }).include).toEqual([
        'src/orders/**/*.ts',
      ]);
      expect(resolvePaths({ root: tmpDir, file: 'src/a.ts' }).include).toEqual(['src/a.ts']);
      expect(resolvePaths({ root: tmpDir }).include).toBeUndefined();
    });
  });

  describe('loadJestArtifacts', () => {
    it('returns undefined when neither artifact exists', () => {
      expect(loadJestArtifacts(tmpDir)).toBeUndefined();
    });

    it('warns instead of silently swallowing a malformed runtime file', () => {
      fs.writeFileSync(path.join(tmpDir, 'jest-runtime.json'), '{ not json');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadJestArtifacts(tmpDir)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('jest-runtime.json'));
      warn.mockRestore();
    });
  });

  describe('loadReasonerOutputFile', () => {
    it('reports missing files distinctly from invalid ones', () => {
      expect(loadReasonerOutputFile(path.join(tmpDir, 'nope.json'))).toEqual({ status: 'missing' });

      const bad = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(bad, JSON.stringify({ discoveredStates: 'not-an-array' }));
      const result = loadReasonerOutputFile(bad);
      expect(result.status).toBe('invalid');
    });

    it('parses a valid reasoner output', () => {
      const good = path.join(tmpDir, 'good.json');
      fs.writeFileSync(good, JSON.stringify(EMPTY_REASONER_OUTPUT));
      const result = loadReasonerOutputFile(good);
      expect(result).toEqual({ status: 'ok', output: EMPTY_REASONER_OUTPUT });
    });
  });

  describe('loadCodeModelFile', () => {
    it('throws a hint-carrying error when the file is missing', () => {
      expect(() => loadCodeModelFile(path.join(tmpDir, 'code-model.json'))).toThrow(
        /deepcover extract/,
      );
    });

    it('rejects a JSON file that is not a CodeModel', () => {
      const wrong = path.join(tmpDir, 'code-model.json');
      fs.writeFileSync(wrong, JSON.stringify({ hello: 'world' }));
      expect(() => loadCodeModelFile(wrong)).toThrow(/expected \{ modules, dependencyGraph, testInventory \}/);
    });
  });
});
