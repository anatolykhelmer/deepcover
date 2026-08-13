import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CodeModel, ModuleNode } from '../../types/code-model';
import type { IstanbulCoverageData } from '../../resolver/types';
import {
  resolvePaths,
  loadJestArtifacts,
  loadReasonerOutputFile,
  loadCodeModelFile,
  loadIstanbulByMethod,
  computeBugSignals,
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

  describe('loadIstanbulByMethod', () => {
    it('returns undefined when no Istanbul data exists in the directory', () => {
      const modules: ModuleNode[] = [
        {
          filePath: 'src/example.ts',
          classes: [
            {
              name: 'Example',
              type: 'service',
              methods: [
                {
                  name: 'process',
                  visibility: 'public',
                  params: [],
                  returnType: 'void',
                  branches: [],
                  branchCount: 0,
                  throwsErrors: false,
                  hasAsyncOps: false,
                  externalCalls: [],
                  internalCalls: [],
                  startLine: 5,
                  endLine: 10,
                },
              ],
              dependencies: [],
              states: [],
            },
          ],
        },
      ];
      expect(loadIstanbulByMethod(tmpDir, modules)).toBeUndefined();
    });

    it('returns a Map keyed by ClassName.methodName for class methods and filePath.functionName for functions', () => {
      const coverage: IstanbulCoverageData = {
        [path.resolve(tmpDir, 'src/example.ts')]: {
          statementMap: {
            '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
            '1': { start: { line: 6, column: 0 }, end: { line: 6, column: 15 } },
            '2': { start: { line: 15, column: 0 }, end: { line: 15, column: 20 } },
          },
          s: { '0': 1, '1': 1, '2': 0 },
          branchMap: {
            '0': { loc: { start: { line: 6 }, end: { line: 6 } }, type: 'if' },
          },
          b: { '0': [1, 0] },
          fnMap: {},
          f: {},
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, 'istanbul-coverage.json'),
        JSON.stringify(coverage),
      );

      const modules: ModuleNode[] = [
        {
          filePath: 'src/example.ts',
          classes: [
            {
              name: 'Example',
              type: 'service',
              methods: [
                {
                  name: 'process',
                  visibility: 'public',
                  params: [],
                  returnType: 'void',
                  branches: [],
                  branchCount: 0,
                  throwsErrors: false,
                  hasAsyncOps: false,
                  externalCalls: [],
                  internalCalls: [],
                  startLine: 5,
                  endLine: 8,
                },
              ],
              dependencies: [],
              states: [],
            },
          ],
          functions: [
            {
              name: 'helper',
              visibility: 'public',
              params: [],
              returnType: 'string',
              branches: [],
              branchCount: 0,
              throwsErrors: false,
              hasAsyncOps: false,
              externalCalls: [],
              internalCalls: [],
              startLine: 15,
              endLine: 18,
            },
          ],
        },
      ];

      const result = loadIstanbulByMethod(tmpDir, modules);
      expect(result).toBeDefined();
      expect(result!.get('Example.process')).toEqual({
        lineCoveragePercent: 100,
        branchCoveragePercent: 50,
      });
      expect(result!.get('src/example.ts.helper')).toEqual({
        lineCoveragePercent: 0,
        branchCoveragePercent: 100,
      });
    });

    it('returns undefined when Istanbul data exists but matches none of the modules', () => {
      const coverage: IstanbulCoverageData = {
        [path.resolve(tmpDir, 'src/other.ts')]: {
          statementMap: {
            '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
          },
          s: { '0': 1 },
          branchMap: {},
          b: {},
          fnMap: {},
          f: {},
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, 'istanbul-coverage.json'),
        JSON.stringify(coverage),
      );

      const modules: ModuleNode[] = [
        {
          filePath: 'src/example.ts',
          classes: [
            {
              name: 'Example',
              type: 'service',
              methods: [],
              dependencies: [],
              states: [],
            },
          ],
        },
      ];

      expect(loadIstanbulByMethod(tmpDir, modules)).toBeUndefined();
    });
  });

  describe('computeBugSignals', () => {
    it('composes resolveCoverage and runBugDetector without throwing', () => {
      const codeModel: CodeModel = {
        modules: [
          {
            filePath: 'src/service.ts',
            classes: [
              {
                name: 'TestService',
                type: 'service',
                methods: [
                  {
                    name: 'getValue',
                    visibility: 'public',
                    params: [],
                    returnType: 'number',
                    branches: [],
                    branchCount: 0,
                    throwsErrors: false,
                    hasAsyncOps: false,
                    externalCalls: [],
                    internalCalls: [],
                    startLine: 5,
                    endLine: 8,
                  },
                ],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: {
          testFiles: [],
          coverage: {},
        },
      };

      // Verify the function composes resolveCoverage + runBugDetector without throwing.
      const signals = computeBugSignals(codeModel, tmpDir, tmpDir);
      expect(Array.isArray(signals)).toBe(true);
    });

    it('boosts confidence of unhandled-error-path signal when Istanbul branch coverage is < 100%', () => {
      // Build Istanbul fixture with partial branch coverage (50%) in the method's line range.
      // This mirrors the shape in the approved loadIstanbulByMethod test: branchMap with
      // one if-branch and b: [1, 0] giving 50% coverage.
      const coverage: IstanbulCoverageData = {
        [path.resolve(tmpDir, 'src/service.ts')]: {
          statementMap: {
            '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
            '1': { start: { line: 6, column: 0 }, end: { line: 6, column: 20 } },
          },
          s: { '0': 1, '1': 1 },
          branchMap: {
            '0': { loc: { start: { line: 6 }, end: { line: 6 } }, type: 'if' },
          },
          b: { '0': [1, 0] },
          fnMap: {},
          f: {},
        },
      };

      const codeModel: CodeModel = {
        modules: [
          {
            filePath: 'src/service.ts',
            classes: [
              {
                name: 'ErrorService',
                type: 'service',
                methods: [
                  {
                    name: 'risky',
                    visibility: 'public',
                    params: [],
                    returnType: 'void',
                    branches: [
                      {
                        type: 'if',
                        condition: 'state',
                        lineNumber: 6,
                      },
                    ],
                    branchCount: 1,
                    throwsErrors: true,
                    hasAsyncOps: false,
                    externalCalls: [],
                    internalCalls: [],
                    startLine: 5,
                    endLine: 8,
                  },
                ],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: {
          testFiles: [],
          coverage: {},
        },
      };

      // Compute signals without Istanbul data.
      const withoutIstanbul = computeBugSignals(codeModel, tmpDir, path.join(tmpDir, 'no-istanbul'));
      const unhandledWithoutIstanbul = withoutIstanbul.find((s) => s.pattern === 'unhandled-error-path');

      // Compute signals with Istanbul data showing 50% branch coverage.
      fs.writeFileSync(
        path.join(tmpDir, 'istanbul-coverage.json'),
        JSON.stringify(coverage),
      );
      const withIstanbul = computeBugSignals(codeModel, tmpDir, tmpDir);
      const unhandledWithIstanbul = withIstanbul.find((s) => s.pattern === 'unhandled-error-path');

      // Confidence calculation from src/bug-detector/detectors/unhandled-error-path.ts:61-68:
      // base = 0.5
      // +0.1 if throwsErrors (method has throwsErrors: true)
      // +0.1 if istanbul && branchCoveragePercent < 100 (fixture has b:[1,0] = 50% coverage)
      // Without Istanbul: 0.5 + 0.1 = 0.6
      // With Istanbul: 0.5 + 0.1 + 0.1 = 0.7
      expect(unhandledWithoutIstanbul).toBeDefined();
      expect(unhandledWithoutIstanbul?.confidence).toBe(0.6);
      expect(unhandledWithIstanbul).toBeDefined();
      expect(unhandledWithIstanbul?.confidence).toBe(0.7);
    });
  });
});
