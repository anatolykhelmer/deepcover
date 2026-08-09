import {
  collectSourceMethodNames,
  filterClassesForPrompts,
  filterTestFilesByModule,
  scopeModelForReasoner,
  scopeTestFilesToModel,
} from '../module-scope';
import type { ClassNode, CodeModel, ModuleNode, TestFileNode } from '../../types/code-model';

function makeTestFile(filePath: string, targetMethods: string[]): TestFileNode {
  return {
    filePath,
    describes: [
      {
        name: 'SomeDescribe',
        tests: targetMethods.map((m) => ({
          name: `should test ${m}`,
          targetMethod: m,
          assertions: [{ type: 'value_check' as const, target: 'result', matcherUsed: 'toEqual' }],
          mocks: [],
          isAsync: false,
        })),
      },
    ],
  };
}

function makeModule(filePath: string, methodNames: string[]): ModuleNode {
  return {
    filePath,
    classes: [
      {
        name: 'SomeService',
        type: 'service',
        methods: methodNames.map((name) => ({
          name,
          visibility: 'public' as const,
          params: [],
          returnType: 'void',
          branches: [],
          branchCount: 0,
          throwsErrors: false,
          hasAsyncOps: false,
          externalCalls: [],
          internalCalls: [],
          startLine: 1,
          endLine: 10,
        })),
        dependencies: [],
        states: [],
      },
    ],
    functions: [],
  };
}

describe('collectSourceMethodNames', () => {
  it('collects method names across modules and classes', () => {
    const modules = [
      makeModule('/repo/src/orders/orders.service.ts', ['createOrder']),
      makeModule('/repo/src/orders/inventory.service.ts', ['reserve', 'release']),
    ];

    expect(collectSourceMethodNames(modules)).toEqual(
      new Set(['createOrder', 'reserve', 'release']),
    );
  });

  it('includes standalone exported functions', () => {
    const modules: ModuleNode[] = [
      {
        filePath: '/repo/src/utils/format.ts',
        classes: [],
        functions: [
          {
            name: 'formatMoney',
            visibility: 'public',
            params: [],
            returnType: 'string',
            branches: [],
            branchCount: 0,
            throwsErrors: false,
            hasAsyncOps: false,
            externalCalls: [],
            internalCalls: [],
            startLine: 1,
            endLine: 3,
          },
        ],
      },
    ];

    expect(collectSourceMethodNames(modules)).toEqual(new Set(['formatMoney']));
  });

  it('returns an empty set for modules with no classes or functions', () => {
    expect(collectSourceMethodNames([])).toEqual(new Set());
  });
});

describe('scopeTestFilesToModel', () => {
  const modules = [makeModule('/repo/src/orders/orders.service.ts', ['createOrder'])];
  const sourceMethodNames = collectSourceMethodNames(modules);

  const ordersSpec = makeTestFile('/repo/src/orders/orders.service.spec.ts', ['createOrder']);
  const calculatorSpec = makeTestFile('/repo/src/calculator/calculator.spec.ts', ['calculate']);
  const sharedSpec = makeTestFile('/repo/test/e2e/orders.e2e.spec.ts', ['createOrder']);

  it('keeps test files living alongside the model source files', () => {
    const result = scopeTestFilesToModel([ordersSpec, calculatorSpec], modules, sourceMethodNames);

    expect(result).toEqual([ordersSpec]);
  });

  it('drops test files from directories the model does not cover', () => {
    const result = scopeTestFilesToModel([ordersSpec, calculatorSpec], modules, sourceMethodNames);

    expect(result).not.toContain(calculatorSpec);
  });

  it('keeps out-of-directory tests that target a known source method', () => {
    const result = scopeTestFilesToModel([sharedSpec], modules, sourceMethodNames);

    expect(result).toEqual([sharedSpec]);
  });

  it('returns all files when the model has no modules', () => {
    const all = [ordersSpec, calculatorSpec];

    expect(scopeTestFilesToModel(all, [], new Set())).toEqual(all);
  });
});

describe('filterTestFilesByModule', () => {
  const notificationsUnit = makeTestFile('src/notifications/__tests__/handler.spec.ts', ['handleEvent']);
  const notificationsE2e = makeTestFile('test/notifications/notifications.e2e.spec.ts', ['handleEvent']);
  const ordersUnit = makeTestFile('src/orders/__tests__/orders.spec.ts', ['createOrder']);
  const paymentsUnit = makeTestFile('src/payments/__tests__/payments.spec.ts', ['processPayment']);
  const sharedHelper = makeTestFile('src/shared/__tests__/utils.spec.ts', ['handleEvent', 'createOrder']);

  const allFiles = [notificationsUnit, notificationsE2e, ordersUnit, paymentsUnit, sharedHelper];

  it('returns all files when modulePath is undefined', () => {
    const result = filterTestFilesByModule(allFiles, undefined, new Set());
    expect(result).toHaveLength(5);
  });

  it('filters by module basename in file path', () => {
    const methods = new Set(['handleEvent']);
    const result = filterTestFilesByModule(allFiles, 'src/notifications', methods);

    expect(result).toContain(notificationsUnit);
    expect(result).toContain(notificationsE2e);
  });

  it('includes files that test relevant methods even if path does not match', () => {
    const methods = new Set(['handleEvent']);
    const result = filterTestFilesByModule(allFiles, 'src/notifications', methods);

    expect(result).toContain(sharedHelper);
  });

  it('excludes files with no path match and no relevant methods', () => {
    const methods = new Set(['handleEvent']);
    const result = filterTestFilesByModule(allFiles, 'src/notifications', methods);

    expect(result).not.toContain(ordersUnit);
    expect(result).not.toContain(paymentsUnit);
  });

  it('handles trailing slash in modulePath', () => {
    const methods = new Set(['handleEvent']);
    const result = filterTestFilesByModule(allFiles, 'src/notifications/', methods);

    expect(result).toContain(notificationsUnit);
    expect(result).toContain(notificationsE2e);
  });

  it('returns empty array when no files match', () => {
    const methods = new Set(['unknownMethod']);
    const result = filterTestFilesByModule(allFiles, 'src/nonexistent', methods);

    expect(result).toHaveLength(0);
  });
});

describe('filterClassesForPrompts', () => {
  const makeClass = (name: string, type: ClassNode['type'], methodCount: number): ClassNode => ({
    name,
    type,
    methods: Array.from({ length: methodCount }, (_, i) => ({
      name: `method${i}`,
      visibility: 'public' as const,
      params: [],
      returnType: 'void',
      branches: [],
      branchCount: 0,
      throwsErrors: false,
      hasAsyncOps: false,
      externalCalls: [],
      internalCalls: [],
      startLine: 1,
      endLine: 10,
    })),
    dependencies: [],
    states: [],
  });

  it('keeps classes with methods', () => {
    const classes = [makeClass('FooService', 'service', 2), makeClass('BarDto', 'dto', 1)];
    expect(filterClassesForPrompts(classes)).toHaveLength(2);
  });

  it('filters out zero-method DTOs and "other" classes', () => {
    const classes = [
      makeClass('FooService', 'service', 2),
      makeClass('TiersDto', 'dto', 0),
      makeClass('ValidationError', 'other', 0),
    ];
    const result = filterClassesForPrompts(classes);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('FooService');
  });

  it('keeps zero-method structural classes (controller, service, gateway, module)', () => {
    const classes = [
      makeClass('AppModule', 'module', 0),
      makeClass('HealthController', 'controller', 0),
      makeClass('EventGateway', 'gateway', 0),
      makeClass('EmptyService', 'service', 0),
    ];
    expect(filterClassesForPrompts(classes)).toHaveLength(4);
  });

  it('returns empty array for empty input', () => {
    expect(filterClassesForPrompts([])).toHaveLength(0);
  });
});

describe('scopeModelForReasoner', () => {
  const ordersSpec = makeTestFile('/repo/src/orders/orders.service.spec.ts', ['createOrder']);
  const calculatorSpec = makeTestFile('/repo/src/calculator/calculator.spec.ts', ['calculate']);

  const model: CodeModel = {
    modules: [
      {
        filePath: '/repo/src/orders/orders.service.ts',
        classes: [
          makeModule('/repo/src/orders/orders.service.ts', ['createOrder']).classes[0],
          {
            name: 'CreateOrderDto',
            type: 'dto',
            methods: [],
            dependencies: [],
            states: [],
          },
        ],
        functions: [],
      },
    ],
    dependencyGraph: [],
    testInventory: { testFiles: [ordersSpec, calculatorSpec], coverage: {} },
  };

  it('drops tests outside the module', () => {
    const scoped = scopeModelForReasoner(model, 'src/orders');

    expect(scoped.testInventory.testFiles).toEqual([ordersSpec]);
  });

  it('drops zero-method DTOs from the prompt classes', () => {
    const scoped = scopeModelForReasoner(model, 'src/orders');

    expect(scoped.modules[0].classes.map((c) => c.name)).toEqual(['SomeService']);
  });

  it('scopes by the model source dirs when no module path is given', () => {
    const scoped = scopeModelForReasoner(model);

    expect(scoped.testInventory.testFiles).toEqual([ordersSpec]);
  });

  it('leaves the original model untouched', () => {
    scopeModelForReasoner(model, 'src/orders');

    expect(model.testInventory.testFiles).toHaveLength(2);
    expect(model.modules[0].classes).toHaveLength(2);
  });

  it('preserves the dependency graph and coverage map', () => {
    const scoped = scopeModelForReasoner(model, 'src/orders');

    expect(scoped.dependencyGraph).toBe(model.dependencyGraph);
    expect(scoped.testInventory.coverage).toBe(model.testInventory.coverage);
  });
});
