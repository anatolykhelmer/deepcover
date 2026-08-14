import { matchRuntimeTests } from '../runtime-matcher';
import type { JestRuntimeData } from '../types';
import type { TestFileNode } from '../../types/code-model';
import { buildClassMethodOwners } from '../../types/method-owner';

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

  it('matches when inventory paths are absolute, as produced by a real extract', () => {
    // extractCodeModel globs with absolute: true, so TestFileNode.filePath is
    // absolute in real runs — only unit fixtures use relative paths.
    const absoluteTestFiles: TestFileNode[] = [{
      ...testFiles[0],
      filePath: '/project/src/order.spec.ts',
    }];
    const result = matchRuntimeTests(runtime, absoluteTestFiles, '/project');
    const methodTests = result.get('createOrder');
    expect(methodTests).toBeDefined();
    expect(methodTests!.passed).toContain('should create order');
    expect(methodTests!.failed).toContain('should fail on invalid input');
  });

  describe('class-owned methods (cross-class leak regression)', () => {
    const crossClassRuntime: JestRuntimeData = {
      testResults: [
        { testFilePath: '/project/src/a.spec.ts', testName: 'AService > adds one', status: 'passed', duration: 5, assertionCount: 1 },
      ],
      timestamp: '2026-01-01',
    };

    const aTestFile: TestFileNode = {
      filePath: 'src/a.spec.ts',
      describes: [{
        name: 'AService',
        tests: [
          { name: 'adds one', targetMethod: 'doThing', targetClass: 'AService', assertions: [], mocks: [], isAsync: false },
        ],
      }],
    };

    const classMethodOwners = buildClassMethodOwners([
      {
        filePath: 'src/a.service.ts',
        classes: [{ name: 'AService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
      },
      {
        filePath: 'src/b.service.ts',
        classes: [{ name: 'BService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
      },
    ]);

    it('keys a class-owned method by its file-qualified name, not the bare name', () => {
      const result = matchRuntimeTests(crossClassRuntime, [aTestFile], '/project', classMethodOwners);
      expect(result.get('src/a.service.ts:AService.doThing')?.passed).toContain('adds one');
      expect(result.has('doThing')).toBe(false);
    });

    it('does not let an unrelated class share the bare method name key', () => {
      const result = matchRuntimeTests(crossClassRuntime, [aTestFile], '/project', classMethodOwners);
      // A same-named BService.doThing must not pick up AService's runtime result.
      expect(result.get('src/b.service.ts:BService.doThing')).toBeUndefined();
    });

    it('fails closed when a duplicated class name has no resolved import file', () => {
      // Both files declare AService; without targetClassFile the credit is dropped.
      const dupOwners = buildClassMethodOwners([
        {
          filePath: 'src/a1/a.service.ts',
          classes: [{ name: 'AService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
        },
        {
          filePath: 'src/a2/a.service.ts',
          classes: [{ name: 'AService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
        },
      ]);
      const result = matchRuntimeTests(crossClassRuntime, [aTestFile], '/project', dupOwners);
      expect(result.size).toBe(0);
    });

    it('attributes to the declaring file resolved from the test import', () => {
      const dupOwners = buildClassMethodOwners([
        {
          filePath: 'src/a1/a.service.ts',
          classes: [{ name: 'AService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
        },
        {
          filePath: 'src/a2/a.service.ts',
          classes: [{ name: 'AService', type: 'service', methods: [{ name: 'doThing' } as never], dependencies: [], states: [] }],
        },
      ]);
      const testFileWithImport: TestFileNode = {
        filePath: 'src/a.spec.ts',
        describes: [{
          name: 'AService',
          tests: [
            { name: 'adds one', targetMethod: 'doThing', targetClass: 'AService', targetClassFile: 'src/a2/a.service.ts', assertions: [], mocks: [], isAsync: false },
          ],
        }],
      };
      const result = matchRuntimeTests(crossClassRuntime, [testFileWithImport], '/project', dupOwners);
      expect(result.get('src/a2/a.service.ts:AService.doThing')?.passed).toContain('adds one');
    });
  });
});
