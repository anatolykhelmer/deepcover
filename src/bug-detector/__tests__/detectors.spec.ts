import { UnhandledErrorPathDetector } from '../detectors/unhandled-error-path';
import { UncheckedNullableDetector } from '../detectors/unchecked-nullable';
import { AssertionMismatchDetector } from '../detectors/assertion-mismatch';
import { MissingBoundaryDetector } from '../detectors/missing-boundary';
import { runBugDetector } from '../index';
import type { CodeModel } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';

function makeCodeModel(overrides: Partial<CodeModel> = {}): CodeModel {
  return {
    modules: [],
    dependencyGraph: [],
    testInventory: { testFiles: [], coverage: {} },
    ...overrides,
  };
}

function makeCoverage(methods: Map<string, { isCovered: boolean; staticTests: string[] }> = new Map()): ResolvedCoverage {
  return {
    methods: new Map(),
    hasIstanbulData: false,
    hasRuntimeData: false,
    isMethodCovered: (cls, method) => methods.get(`${cls}.${method}`)?.isCovered ?? false,
    getMethodCoverage: () => undefined,
    getTestsForMethod: (cls, method) => methods.get(`${cls}.${method}`)?.staticTests ?? [],
  };
}

describe('UnhandledErrorPathDetector', () => {
  const detector = new UnhandledErrorPathDetector();

  it('detects method with try_catch branch and no error-path test', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/order.service.ts',
        classes: [{
          name: 'OrderService', type: 'service',
          methods: [{
            name: 'createOrder', visibility: 'public', params: [], returnType: 'Promise<Order>',
            branches: [{ type: 'try_catch', condition: 'catch (error)', lineNumber: 15 }],
            branchCount: 2, throwsErrors: true, hasAsyncOps: true,
            externalCalls: ['repository.save'], internalCalls: [], startLine: 10, endLine: 30,
          }],
          dependencies: ['OrderRepository'], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/order.service.spec.ts', describes: [{ name: 'OrderService',
          tests: [{ name: 'should create an order', targetMethod: 'createOrder',
            assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }],
            mocks: ['OrderRepository'], isAsync: true }],
        }] }],
        coverage: { createOrder: ['should create an order'] },
      },
    });
    const coverage = makeCoverage(new Map([
      ['OrderService.createOrder', { isCovered: true, staticTests: ['should create an order'] }],
    ]));
    const signals = detector.detect(codeModel, coverage);
    expect(signals).toHaveLength(1);
    expect(signals[0].pattern).toBe('unhandled-error-path');
    expect(signals[0].className).toBe('OrderService');
    expect(signals[0].methodName).toBe('createOrder');
    expect(signals[0].confidence).toBeGreaterThan(0);
  });

  it('does not flag method when test throws into catch block', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/order.service.ts',
        classes: [{
          name: 'OrderService', type: 'service',
          methods: [{
            name: 'createOrder', visibility: 'public', params: [], returnType: 'Promise<Order>',
            branches: [{ type: 'try_catch', condition: 'catch (error)', lineNumber: 15 }],
            branchCount: 2, throwsErrors: true, hasAsyncOps: true,
            externalCalls: ['repository.save'], internalCalls: [], startLine: 10, endLine: 30,
          }],
          dependencies: ['OrderRepository'], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/order.service.spec.ts', describes: [{ name: 'OrderService',
          tests: [
            { name: 'should create an order', targetMethod: 'createOrder',
              assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }],
              mocks: ['OrderRepository'], isAsync: true },
            { name: 'should handle repository error', targetMethod: 'createOrder',
              assertions: [{ type: 'rejects', target: 'createOrder', matcherUsed: 'toThrow' }],
              mocks: ['OrderRepository'], isAsync: true },
          ],
        }] }],
        coverage: { createOrder: ['should create an order', 'should handle repository error'] },
      },
    });
    const coverage = makeCoverage(new Map([
      ['OrderService.createOrder', { isCovered: true, staticTests: ['should create an order', 'should handle repository error'] }],
    ]));
    const signals = detector.detect(codeModel, coverage);
    expect(signals).toHaveLength(0);
  });

  it('ignores methods without try_catch branches', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/user.service.ts',
        classes: [{
          name: 'UserService', type: 'service',
          methods: [{
            name: 'getUser', visibility: 'public',
            params: [{ name: 'id', type: 'string', isOptional: false }],
            returnType: 'User', branches: [], branchCount: 0, throwsErrors: false,
            hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 5, endLine: 8,
          }],
          dependencies: [], states: [],
        }],
      }],
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });
});

describe('UncheckedNullableDetector', () => {
  const detector = new UncheckedNullableDetector();

  it('detects nullable parameter never tested with null', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/user.service.ts',
        classes: [{
          name: 'UserService', type: 'service',
          methods: [{
            name: 'findUser', visibility: 'public',
            params: [{ name: 'id', type: 'string | null', isOptional: false }],
            returnType: 'User | null',
            branches: [{ type: 'if', condition: 'id === null', lineNumber: 12 }],
            branchCount: 2, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 10, endLine: 20,
          }],
          dependencies: [], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/user.service.spec.ts', describes: [{ name: 'UserService',
          tests: [{ name: 'should find user by id', targetMethod: 'findUser',
            assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }],
            mocks: [], isAsync: false }],
        }] }],
        coverage: { findUser: ['should find user by id'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].pattern).toBe('unchecked-nullable');
    expect(signals[0].evidence).toContain('id');
  });

  it('does not flag non-nullable parameters', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/user.service.ts',
        classes: [{
          name: 'UserService', type: 'service',
          methods: [{
            name: 'findUser', visibility: 'public',
            params: [{ name: 'id', type: 'string', isOptional: false }],
            returnType: 'User', branches: [], branchCount: 0, throwsErrors: false,
            hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 10, endLine: 15,
          }],
          dependencies: [], states: [],
        }],
      }],
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });

  it('detects optional parameter without null test', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/config.service.ts',
        classes: [{
          name: 'ConfigService', type: 'service',
          methods: [{
            name: 'getValue', visibility: 'public',
            params: [
              { name: 'key', type: 'string', isOptional: false },
              { name: 'defaultValue', type: 'string', isOptional: true },
            ],
            returnType: 'string',
            branches: [{ type: 'if', condition: 'defaultValue !== undefined', lineNumber: 8 }],
            branchCount: 2, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 5, endLine: 15,
          }],
          dependencies: [], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/config.spec.ts', describes: [{ name: 'ConfigService',
          tests: [{ name: 'should get value with default', targetMethod: 'getValue',
            assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
            mocks: [], isAsync: false }],
        }] }],
        coverage: { getValue: ['should get value with default'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].evidence).toContain('defaultValue');
  });
});

describe('AssertionMismatchDetector', () => {
  const detector = new AssertionMismatchDetector();

  it('detects test that only asserts on mock calls for non-void method', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/payment.service.ts',
        classes: [{
          name: 'PaymentService', type: 'service',
          methods: [{
            name: 'processPayment', visibility: 'public',
            params: [{ name: 'amount', type: 'number', isOptional: false }],
            returnType: 'PaymentResult', branches: [], branchCount: 1, throwsErrors: false,
            hasAsyncOps: true, externalCalls: ['gateway.charge'], internalCalls: [],
            startLine: 10, endLine: 25,
          }],
          dependencies: ['PaymentGateway'], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/payment.spec.ts', describes: [{ name: 'PaymentService',
          tests: [{ name: 'should process payment', targetMethod: 'processPayment',
            assertions: [
              { type: 'called_with', target: 'gateway.charge', matcherUsed: 'toHaveBeenCalledWith' },
              { type: 'spy_call_count', target: 'gateway.charge', matcherUsed: 'toHaveBeenCalledTimes' },
            ],
            mocks: ['PaymentGateway'], isAsync: true }],
        }] }],
        coverage: { processPayment: ['should process payment'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(1);
    expect(signals[0].pattern).toBe('assertion-mismatch');
    expect(signals[0].evidence).toContain('return value');
  });

  it('does not flag void methods', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/logger.service.ts',
        classes: [{
          name: 'LoggerService', type: 'service',
          methods: [{
            name: 'log', visibility: 'public',
            params: [{ name: 'message', type: 'string', isOptional: false }],
            returnType: 'void', branches: [], branchCount: 0, throwsErrors: false,
            hasAsyncOps: false, externalCalls: ['console.log'], internalCalls: [],
            startLine: 5, endLine: 8,
          }],
          dependencies: [], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/logger.spec.ts', describes: [{ name: 'LoggerService',
          tests: [{ name: 'should log message', targetMethod: 'log',
            assertions: [{ type: 'called_with', target: 'console.log', matcherUsed: 'toHaveBeenCalledWith' }],
            mocks: [], isAsync: false }],
        }] }],
        coverage: { log: ['should log message'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });

  it('does not flag test with value_check assertion', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/calc.service.ts',
        classes: [{
          name: 'CalcService', type: 'service',
          methods: [{
            name: 'add', visibility: 'public', params: [], returnType: 'number',
            branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 5, endLine: 8,
          }],
          dependencies: [], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/calc.spec.ts', describes: [{ name: 'CalcService',
          tests: [{ name: 'should add', targetMethod: 'add',
            assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
            mocks: [], isAsync: false }],
        }] }],
        coverage: { add: ['should add'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });
});

describe('MissingBoundaryDetector', () => {
  const detector = new MissingBoundaryDetector();

  it('detects numeric boundary condition without boundary test', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/discount.service.ts',
        classes: [{
          name: 'DiscountService', type: 'service',
          methods: [{
            name: 'calculateDiscount', visibility: 'public',
            params: [{ name: 'amount', type: 'number', isOptional: false }],
            returnType: 'number',
            branches: [
              { type: 'if', condition: 'amount > 0', lineNumber: 8 },
              { type: 'if', condition: 'amount >= 100', lineNumber: 12 },
            ],
            branchCount: 4, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 5, endLine: 20,
          }],
          dependencies: [], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/discount.spec.ts', describes: [{ name: 'DiscountService',
          tests: [{ name: 'should calculate discount for valid amount', targetMethod: 'calculateDiscount',
            assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBe' }],
            mocks: [], isAsync: false }],
        }] }],
        coverage: { calculateDiscount: ['should calculate discount for valid amount'] },
      },
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].pattern).toBe('missing-boundary');
    expect(signals[0].evidence).toContain('amount');
  });

  it('ignores methods without numeric conditions', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/name.service.ts',
        classes: [{
          name: 'NameService', type: 'service',
          methods: [{
            name: 'greet', visibility: 'public',
            params: [{ name: 'name', type: 'string', isOptional: false }],
            returnType: 'string', branches: [], branchCount: 0, throwsErrors: false,
            hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 5, endLine: 8,
          }],
          dependencies: [], states: [],
        }],
      }],
    });
    const signals = detector.detect(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });
});

describe('runBugDetector', () => {
  it('runs all detectors and returns combined signals', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/service.ts',
        classes: [{
          name: 'Service', type: 'service',
          methods: [{
            name: 'process', visibility: 'public',
            params: [{ name: 'input', type: 'string | null', isOptional: false }],
            returnType: 'Result',
            branches: [
              { type: 'try_catch', condition: 'catch (e)', lineNumber: 10 },
              { type: 'if', condition: 'input === null', lineNumber: 12 },
            ],
            branchCount: 4, throwsErrors: true, hasAsyncOps: true,
            externalCalls: ['dep.call'], internalCalls: [], startLine: 5, endLine: 30,
          }],
          dependencies: ['Dep'], states: [],
        }],
      }],
      testInventory: {
        testFiles: [{ filePath: '__tests__/service.spec.ts', describes: [{ name: 'Service',
          tests: [{ name: 'should process input', targetMethod: 'process',
            assertions: [{ type: 'called_with', target: 'dep.call', matcherUsed: 'toHaveBeenCalledWith' }],
            mocks: ['Dep'], isAsync: true }],
        }] }],
        coverage: { process: ['should process input'] },
      },
    });
    const signals = runBugDetector(codeModel, makeCoverage());
    expect(signals.length).toBeGreaterThanOrEqual(2);
    const patterns = signals.map((s) => s.pattern);
    expect(patterns).toContain('unhandled-error-path');
    expect(patterns).toContain('unchecked-nullable');
  });

  it('returns empty array for clean code', () => {
    const codeModel = makeCodeModel({
      modules: [{
        filePath: 'src/simple.ts',
        classes: [{
          name: 'Simple', type: 'service',
          methods: [{
            name: 'hello', visibility: 'public', params: [], returnType: 'string',
            branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false,
            externalCalls: [], internalCalls: [], startLine: 1, endLine: 3,
          }],
          dependencies: [], states: [],
        }],
      }],
    });
    const signals = runBugDetector(codeModel, makeCoverage());
    expect(signals).toHaveLength(0);
  });
});
