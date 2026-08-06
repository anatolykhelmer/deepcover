import { matchRuntimeTests } from '../runtime-matcher';
import type { JestRuntimeData } from '../types';
import type { TestFileNode } from '../../types/code-model';

describe('matchRuntimeTests', () => {
  const runtime: JestRuntimeData = {
    testResults: [
      { testFilePath: '/project/src/order.spec.ts', testName: 'OrderService > should create order', status: 'passed', duration: 10, assertionCount: 3 },
      { testFilePath: '/project/src/order.spec.ts', testName: 'OrderService > should fail on invalid input', status: 'failed', duration: 5, assertionCount: 0 },
      { testFilePath: '/project/src/order.spec.ts', testName: 'OrderService > should skip this', status: 'skipped', duration: 0, assertionCount: 0 },
    ],
    timestamp: '2026-01-01',
  };

  const testFiles: TestFileNode[] = [{
    filePath: 'src/order.spec.ts',
    describes: [{
      name: 'OrderService',
      tests: [
        { name: 'should create order', targetMethod: 'createOrder', assertions: [], mocks: [], isAsync: false },
        { name: 'should fail on invalid input', targetMethod: 'createOrder', assertions: [], mocks: [], isAsync: false },
        { name: 'should skip this', targetMethod: 'createOrder', assertions: [], mocks: [], isAsync: false },
      ],
    }],
  }];

  it('matches runtime tests to methods by suffix and file path', () => {
    const result = matchRuntimeTests(runtime, testFiles, '/project');
    const methodTests = result.get('createOrder');
    expect(methodTests).toBeDefined();
    expect(methodTests!.passed).toContain('should create order');
    expect(methodTests!.failed).toContain('should fail on invalid input');
    expect(methodTests!.skipped).toContain('should skip this');
  });

  it('returns empty map when no runtime data provided', () => {
    const result = matchRuntimeTests(undefined, testFiles, '/project');
    expect(result.size).toBe(0);
  });
});
