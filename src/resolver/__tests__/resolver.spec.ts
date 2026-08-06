import { resolveCoverage } from '../index';
import type { CodeModel } from '../../types/code-model';
import type { IstanbulCoverageData, JestRuntimeData } from '../types';

function createMinimalCodeModel(): CodeModel {
  return {
    modules: [{
      filePath: 'src/order.service.ts',
      classes: [{
        name: 'OrderService',
        type: 'service',
        methods: [
          {
            name: 'create', visibility: 'public', params: [], returnType: 'void',
            branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 5, endLine: 10,
          },
          {
            name: 'delete', visibility: 'public', params: [], returnType: 'void',
            branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 12, endLine: 18,
          },
        ],
        dependencies: [],
        states: [],
      }],
    }],
    dependencyGraph: [],
    testInventory: {
      testFiles: [],
      coverage: { create: ['test: should create'] },
    },
  };
}

describe('resolveCoverage', () => {
  it('falls back to static coverage when no Jest data', () => {
    const model = createMinimalCodeModel();
    const resolved = resolveCoverage(model, '/project');

    expect(resolved.hasIstanbulData).toBe(false);
    expect(resolved.hasRuntimeData).toBe(false);
    expect(resolved.isMethodCovered('OrderService', 'create')).toBe(true);
    expect(resolved.isMethodCovered('OrderService', 'delete')).toBe(false);
  });

  it('uses Istanbul when available, overriding static', () => {
    const model = createMinimalCodeModel();
    const istanbul: IstanbulCoverageData = {
      '/project/src/order.service.ts': {
        statementMap: {
          '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 30 } },
          '1': { start: { line: 13, column: 0 }, end: { line: 13, column: 20 } },
        },
        s: { '0': 1, '1': 0 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
    };

    const resolved = resolveCoverage(model, '/project', { istanbul });

    expect(resolved.hasIstanbulData).toBe(true);
    const createCov = resolved.getMethodCoverage('OrderService', 'create');
    expect(createCov?.istanbul?.linesCovered).toBe(1);
    expect(createCov?.coverageSource).toBe('istanbul');
    expect(resolved.isMethodCovered('OrderService', 'delete')).toBe(false);
  });

  it('getTestsForMethod merges static + passed runtime tests', () => {
    const model = createMinimalCodeModel();
    model.testInventory.testFiles = [{
      filePath: 'src/order.spec.ts',
      describes: [{
        name: 'OrderService',
        tests: [{ name: 'should create', targetMethod: 'create', assertions: [], mocks: [], isAsync: false }],
      }],
    }];
    const runtime: JestRuntimeData = {
      testResults: [
        { testFilePath: '/project/src/order.spec.ts', testName: 'OrderService > should create', status: 'passed', duration: 5, assertionCount: 2 },
      ],
      timestamp: '2026-01-01',
    };

    const resolved = resolveCoverage(model, '/project', { runtime });
    const tests = resolved.getTestsForMethod('OrderService', 'create');
    expect(tests).toContain('should create');
  });
});
