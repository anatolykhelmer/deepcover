import { UncheckedNullableDetector } from '../detectors/unchecked-nullable';
import { AssertionMismatchDetector } from '../detectors/assertion-mismatch';
import { MissingBoundaryDetector } from '../detectors/missing-boundary';
import type { CodeModel, MethodNode, FunctionNode, TestNode } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';

/**
 * The three detectors that task 021 did not reach: they scanned tests by bare
 * method name and never looked at `mod.functions`. `unhandled-error-path` and
 * `untested-condition-operand` already behave as asserted here.
 */

function makeCodeModel(overrides: Partial<CodeModel> = {}): CodeModel {
  return {
    modules: [],
    dependencyGraph: [],
    testInventory: { testFiles: [], coverage: {} },
    ...overrides,
  };
}

function makeCoverage(): ResolvedCoverage {
  return {
    methods: new Map(),
    hasIstanbulData: false,
    hasRuntimeData: false,
    isMethodCovered: () => false,
    getMethodCoverage: () => undefined,
    getTestsForMethod: () => [],
  };
}

const callableBase = {
  visibility: 'public' as const,
  params: [],
  returnType: 'void',
  branches: [],
  branchCount: 0,
  throwsErrors: false,
  hasAsyncOps: false,
  externalCalls: [],
  internalCalls: [],
  startLine: 5,
  endLine: 20,
};

function method(overrides: Partial<MethodNode> & { name: string }): MethodNode {
  return { ...callableBase, ...overrides };
}

function fn(overrides: Partial<FunctionNode> & { name: string }): FunctionNode {
  return { ...callableBase, ...overrides };
}

/** Same class name declared in two files, each with the same method. */
function twoFilesDeclaring(className: string, m: MethodNode): CodeModel['modules'] {
  return [
    {
      filePath: 'src/a/service.ts',
      classes: [{ name: className, type: 'service', methods: [{ ...m }], dependencies: [], states: [] }],
    },
    {
      filePath: 'src/b/service.ts',
      classes: [{ name: className, type: 'service', methods: [{ ...m }], dependencies: [], states: [] }],
    },
  ];
}

function testFileFor(className: string, tests: TestNode[]): CodeModel['testInventory'] {
  return {
    testFiles: [{ filePath: 'src/a/service.spec.ts', describes: [{ name: className, tests }] }],
    coverage: {},
  };
}

describe('AssertionMismatchDetector scoping', () => {
  const detector = new AssertionMismatchDetector();

  it('does not credit a same-named class in another file with this file\'s test', () => {
    const codeModel = makeCodeModel({
      modules: twoFilesDeclaring(
        'PaymentService',
        method({ name: 'processPayment', returnType: 'PaymentResult' }),
      ),
      testInventory: testFileFor('PaymentService', [{
        name: 'should process payment',
        targetMethod: 'processPayment',
        targetClass: 'PaymentService',
        targetClassFile: 'src/a/service.ts',
        assertions: [{ type: 'called_with', target: 'gateway.charge', matcherUsed: 'toHaveBeenCalledWith' }],
        mocks: ['PaymentGateway'],
        isAsync: true,
      }]),
    });

    const files = detector.detect(codeModel, makeCoverage()).map((s) => s.sourceLocation.file);
    // Only a/ has a test at all, and it asserts on mocks only — b/ is untested,
    // which is a coverage gap, not an assertion mismatch.
    expect(files).toEqual(['src/a/service.ts']);
  });

  it('flags a standalone function whose test only asserts on mock calls', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/total.ts',
        classes: [],
        functions: [fn({ name: 'computeTotal', returnType: 'number', externalCalls: ['rates.fetch'] })],
      }],
      testInventory: {
        testFiles: [{ filePath: 'src/total.spec.ts', describes: [{ name: 'computeTotal', tests: [{
          name: 'should compute total',
          targetMethod: 'computeTotal',
          assertions: [{ type: 'called_with', target: 'rates.fetch', matcherUsed: 'toHaveBeenCalledWith' }],
          mocks: ['rates'],
          isAsync: false,
        }] }] }],
        coverage: {},
      },
    });

    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].methodName).toBe('computeTotal');
    expect(signals[0].sourceLocation.file).toBe('src/total.ts');
  });
});

describe('MissingBoundaryDetector scoping', () => {
  const detector = new MissingBoundaryDetector();

  it('does not let one file\'s boundary test silence a same-named class in another file', () => {
    const codeModel = makeCodeModel({
      modules: twoFilesDeclaring(
        'DiscountService',
        method({
          name: 'calculateDiscount',
          returnType: 'number',
          branches: [{ type: 'if', condition: 'amount >= 100', lineNumber: 12 }],
          branchCount: 2,
        }),
      ),
      testInventory: testFileFor('DiscountService', [{
        name: 'handles zero amount',
        targetMethod: 'calculateDiscount',
        targetClass: 'DiscountService',
        targetClassFile: 'src/a/service.ts',
        assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
        mocks: [],
        isAsync: false,
      }]),
    });

    const files = detector.detect(codeModel, makeCoverage()).map((s) => s.sourceLocation.file);
    expect(files).toContain('src/b/service.ts');
    expect(files).not.toContain('src/a/service.ts');
  });

  it('flags a standalone function with an untested boundary condition', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/discount.ts',
        classes: [],
        functions: [fn({
          name: 'applyDiscount',
          returnType: 'number',
          branches: [{ type: 'if', condition: 'amount >= 100', lineNumber: 8 }],
          branchCount: 2,
        })],
      }],
      testInventory: {
        testFiles: [{ filePath: 'src/discount.spec.ts', describes: [{ name: 'applyDiscount', tests: [{
          name: 'should apply a discount',
          targetMethod: 'applyDiscount',
          assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
          mocks: [],
          isAsync: false,
        }] }] }],
        coverage: {},
      },
    });

    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].methodName).toBe('applyDiscount');
    expect(signals[0].sourceLocation.file).toBe('src/discount.ts');
  });
});

describe('UncheckedNullableDetector scoping', () => {
  const detector = new UncheckedNullableDetector();

  it('does not let one file\'s null test silence a same-named class in another file', () => {
    const codeModel = makeCodeModel({
      modules: twoFilesDeclaring(
        'UserService',
        method({
          name: 'findUser',
          returnType: 'User | null',
          params: [{ name: 'id', type: 'string | null', isOptional: false }],
        }),
      ),
      testInventory: testFileFor('UserService', [{
        name: 'returns null when id is null',
        targetMethod: 'findUser',
        targetClass: 'UserService',
        targetClassFile: 'src/a/service.ts',
        assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBeNull' }],
        mocks: [],
        isAsync: false,
      }]),
    });

    const files = detector.detect(codeModel, makeCoverage()).map((s) => s.sourceLocation.file);
    expect(files).toContain('src/b/service.ts');
    expect(files).not.toContain('src/a/service.ts');
  });

  it('flags a standalone function with an untested nullable parameter', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/format.ts',
        classes: [],
        functions: [fn({
          name: 'format',
          returnType: 'string',
          params: [{ name: 'value', type: 'string', isOptional: true }],
        })],
      }],
      testInventory: {
        testFiles: [{ filePath: 'src/format.spec.ts', describes: [{ name: 'format', tests: [{
          name: 'should format a value',
          targetMethod: 'format',
          assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
          mocks: [],
          isAsync: false,
        }] }] }],
        coverage: {},
      },
    });

    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].evidence).toContain('value');
    expect(signals[0].sourceLocation.file).toBe('src/format.ts');
  });
});
