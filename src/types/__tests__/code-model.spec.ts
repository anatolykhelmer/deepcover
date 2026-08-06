import { CodeModel, ClassNode, MethodNode, FunctionNode, TestNode, AssertionNode } from '../code-model';

describe('CodeModel types', () => {
  it('can construct a minimal CodeModel', () => {
    const model: CodeModel = {
      modules: [{ filePath: '/src/helpers.ts', classes: [], functions: [] }],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: {} },
    };
    expect(model.modules).toHaveLength(1);
    expect(model.modules[0].functions).toEqual([]);
    expect(model.dependencyGraph).toEqual([]);
    expect(model.testInventory.testFiles).toEqual([]);
  });

  it('can construct a ClassNode with methods and states', () => {
    const method: MethodNode = {
      name: 'findAll',
      visibility: 'public',
      params: [{ name: 'status', type: 'Status', isOptional: true }],
      returnType: 'Promise<Item[]>',
      branches: [{ type: 'if', condition: 'status === Active', lineNumber: 10 }],
      branchCount: 1,
      throwsErrors: false,
      hasAsyncOps: true,
      externalCalls: ['HttpService.get'],
      internalCalls: [],
      startLine: 1,
      endLine: 10,
    };

    const classNode: ClassNode = {
      name: 'WebhooksService',
      type: 'service',
      methods: [method],
      dependencies: ['HttpService'],
      states: [{
        source: 'enum',
        name: 'Status',
        values: ['active', 'inactive'],
        affectedMethods: ['findAll'],
      }],
    };

    expect(classNode.name).toBe('WebhooksService');
    expect(classNode.methods).toHaveLength(1);
    expect(classNode.states[0].values).toEqual(['active', 'inactive']);
  });

  it('can construct a TestNode with assertions', () => {
    const assertion: AssertionNode = {
      type: 'value_check',
      target: 'result',
      matcherUsed: 'toEqual',
    };

    const testNode: TestNode = {
      name: 'should return all items',
      targetMethod: 'findAll',
      assertions: [assertion],
      mocks: ['HttpService'],
      isAsync: true,
    };

    expect(testNode.assertions).toHaveLength(1);
    expect(testNode.assertions[0].matcherUsed).toBe('toEqual');
  });

  it('can construct a standalone FunctionNode', () => {
    const fn: FunctionNode = {
      name: 'buildFormattedValidationErrors',
      visibility: 'public',
      params: [{ name: 'errors', type: 'ValidationError[]', isOptional: false }],
      returnType: 'string[]',
      branches: [{ type: 'if', condition: 'errors.length === 0', lineNumber: 8 }],
      branchCount: 1,
      throwsErrors: false,
      hasAsyncOps: false,
      externalCalls: [],
      internalCalls: [],
      startLine: 8,
      endLine: 18,
    };

    expect(fn.name).toBe('buildFormattedValidationErrors');
    expect(fn.branchCount).toBe(1);
  });
});
