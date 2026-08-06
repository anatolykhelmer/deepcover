import { filterTestFilesByModule, filterClassesForPrompts } from '../commands/extract';
import type { ClassNode, TestFileNode } from '../../types/code-model';

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
