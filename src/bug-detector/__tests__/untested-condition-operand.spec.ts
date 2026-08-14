import { UntestedConditionOperandDetector } from '../detectors/untested-condition-operand';
import type {
  BranchNode,
  CodeModel,
  MethodNode,
  TestNode,
} from '../../types/code-model';
import type { BinaryExprCoverage, MethodCoverage, ResolvedCoverage } from '../../resolver/types';

/**
 * The guard from the demo calculator: four `||` operands, two reading `aRaw` and two
 * reading `bRaw` (through the `const a = Number(aRaw)` alias the extractor resolves).
 */
const GUARD: BranchNode = {
  type: 'guard',
  condition: 'aRaw === undefined || bRaw === undefined || Number.isNaN(a) || Number.isNaN(b)',
  lineNumber: 19,
  operator: '||',
  guardExit: 'throw',
  operands: [
    { text: 'aRaw === undefined', paramRefs: ['aRaw'] },
    { text: 'bRaw === undefined', paramRefs: ['bRaw'] },
    { text: 'Number.isNaN(a)', paramRefs: ['aRaw'] },
    { text: 'Number.isNaN(b)', paramRefs: ['bRaw'] },
  ],
};

function makeMethod(overrides: Partial<MethodNode> = {}): MethodNode {
  return {
    name: 'calculate',
    visibility: 'public',
    params: [
      { name: 'aRaw', type: 'string', isOptional: false },
      { name: 'bRaw', type: 'string', isOptional: false },
      { name: 'op', type: 'string', isOptional: false },
    ],
    returnType: '{ result: number }',
    branches: [GUARD],
    branchCount: 2,
    throwsErrors: true,
    hasAsyncOps: false,
    externalCalls: [],
    internalCalls: [],
    startLine: 11,
    endLine: 28,
    ...overrides,
  };
}

function makeTest(name: string, args: string[], throws: boolean): TestNode {
  return {
    name,
    targetMethod: 'calculate',
    targetClass: 'CalculatorController',
    assertions: throws
      ? [{ type: 'throws', target: '() => controller.calculate(...)', matcherUsed: 'toThrow' }]
      : [{ type: 'value_check', target: 'controller.calculate(...)', matcherUsed: 'toEqual' }],
    mocks: [],
    isAsync: false,
    targetCallArgs: args,
  };
}

const HAPPY_PATH = makeTest('returns the sum', ['2', '3', 'add'], false);
const THROWS_ON_A = makeTest('throws on non-numeric input', ['foo', '3', 'add'], true);
const THROWS_ON_OP = makeTest('throws on invalid operation', ['2', '3', 'pow'], true);
const THROWS_ON_B = makeTest('throws when b is non-numeric', ['2', 'foo', 'add'], true);

function makeCodeModel(tests: TestNode[], method: MethodNode = makeMethod()): CodeModel {
  return {
    modules: [{
      filePath: 'src/calculator.controller.ts',
      classes: [{
        name: 'CalculatorController',
        type: 'controller',
        methods: [method],
        dependencies: [],
        states: [],
      }],
    }],
    dependencyGraph: [],
    testInventory: {
      testFiles: [{
        filePath: 'src/calculator.controller.spec.ts',
        describes: [{ name: 'CalculatorController', tests }],
      }],
      coverage: { 'CalculatorController.calculate': tests.map((t) => t.name) },
    },
  };
}

function makeCoverage(
  options: { isCovered?: boolean; binaryExpressions?: BinaryExprCoverage[] } = {}
): ResolvedCoverage {
  const { isCovered = true, binaryExpressions } = options;
  const methodCoverage = {
    className: 'CalculatorController',
    methodName: 'calculate',
    qualifiedName: 'CalculatorController.calculate',
    filePath: 'src/calculator.controller.ts',
    staticTests: [],
    isCovered,
    coverageSource: 'istanbul',
    ...(binaryExpressions
      ? {
          istanbul: {
            linesCovered: 8, linesTotal: 8, lineCoveragePercent: 100,
            branchesHit: 6, branchesTotal: 6, branchCoveragePercent: 100,
            binaryExpressions,
          },
        }
      : {}),
  } as MethodCoverage;

  return {
    methods: new Map(),
    hasIstanbulData: !!binaryExpressions,
    hasRuntimeData: false,
    isMethodCovered: () => isCovered,
    getMethodCoverage: () => methodCoverage,
    getTestsForMethod: () => [],
  };
}

describe('UntestedConditionOperandDetector', () => {
  const detector = new UntestedConditionOperandDetector();

  describe('operand never decisive', () => {
    it('flags the operands no test drives, and only those', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP]),
        makeCoverage()
      );

      expect(signals.map((s) => s.evidence)).toEqual([
        expect.stringContaining('"bRaw === undefined"'),
        expect.stringContaining('"Number.isNaN(b)"'),
      ]);
      expect(signals[0].pattern).toBe('untested-condition-operand');
      expect(signals[0].className).toBe('CalculatorController');
      expect(signals[0].methodName).toBe('calculate');
      expect(signals[0].sourceLocation).toEqual({ file: 'src/calculator.controller.ts', line: 19 });
      // Inference from argument shape, not proof — the Reasoner validates it.
      expect(signals[0].confidence).toBe(0.4);
    });

    it('goes quiet once a test enters the guard through the other operand', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_B, THROWS_ON_OP]),
        makeCoverage()
      );

      expect(signals).toEqual([]);
    });

    it('stays silent without a happy path to compare arguments against', () => {
      const signals = detector.detect(
        makeCodeModel([THROWS_ON_A, THROWS_ON_OP]),
        makeCoverage()
      );

      expect(signals).toEqual([]);
    });

    it('stays silent when no test reaches the throw at all', () => {
      const signals = detector.detect(makeCodeModel([HAPPY_PATH]), makeCoverage());

      expect(signals).toEqual([]);
    });

    it('stays silent when no test varies an input the guard reads', () => {
      // Only `op` is ever varied, so nothing entered this guard — that is missing branch
      // coverage, not an operand that lost its meaning.
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_OP]),
        makeCoverage()
      );

      expect(signals).toEqual([]);
    });

    it('does not let a same-named class in another file silence the signal (task 021)', () => {
      // Two files both declare CalculatorController.calculate. The b/ copy's
      // THROWS_ON_B test must not count as driving a/'s bRaw operands.
      const withFile = (test: TestNode, file: string): TestNode => ({ ...test, targetClassFile: file });
      const aFile = 'src/a/calculator.controller.ts';
      const bFile = 'src/b/calculator.controller.ts';
      const cls = {
        name: 'CalculatorController',
        type: 'controller' as const,
        methods: [makeMethod()],
        dependencies: [],
        states: [],
      };
      const model: CodeModel = {
        modules: [
          { filePath: aFile, classes: [{ ...cls, methods: [makeMethod()] }] },
          { filePath: bFile, classes: [{ ...cls, methods: [makeMethod()] }] },
        ],
        dependencyGraph: [],
        testInventory: {
          testFiles: [
            {
              filePath: 'src/a/calculator.controller.spec.ts',
              describes: [{
                name: 'CalculatorController',
                tests: [HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP].map((t) => withFile(t, aFile)),
              }],
            },
            {
              filePath: 'src/b/calculator.controller.spec.ts',
              describes: [{
                name: 'CalculatorController',
                tests: [withFile(THROWS_ON_B, bFile)],
              }],
            },
          ],
          coverage: {},
        },
      };

      const signals = detector.detect(model, makeCoverage());

      // a/'s bRaw operands are still untested — b/'s test belongs to b/'s class.
      const aSignals = signals.filter((s) => s.sourceLocation.file === aFile);
      expect(aSignals.map((s) => s.evidence)).toEqual([
        expect.stringContaining('"bRaw === undefined"'),
        expect.stringContaining('"Number.isNaN(b)"'),
      ]);
    });

    it('ignores an untested method — that is a coverage gap, reported elsewhere', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP]),
        makeCoverage({ isCovered: false })
      );

      expect(signals).toEqual([]);
    });

    it('ignores a guard that returns instead of throwing (no outcome to partition by)', () => {
      const method = makeMethod({
        branches: [{ ...GUARD, guardExit: 'return' }],
      });
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP], method),
        makeCoverage()
      );

      expect(signals).toEqual([]);
    });

    it('ignores a simple condition with no operands to split', () => {
      const method = makeMethod({
        branches: [{
          type: 'guard', condition: 'Number.isNaN(a)', lineNumber: 19, guardExit: 'throw',
        }],
      });
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP], method),
        makeCoverage()
      );

      expect(signals).toEqual([]);
    });

    it('scopes tests to the class, so a same-named method elsewhere lends no credit', () => {
      const foreign = { ...THROWS_ON_B, targetClass: 'OtherController' };
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP, foreign]),
        makeCoverage()
      );

      expect(signals).toHaveLength(2);
    });
  });

  describe('operand never evaluated', () => {
    it('reports an Istanbul zero as proof, at high confidence', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_B, THROWS_ON_OP]),
        makeCoverage({ binaryExpressions: [{ line: 19, pathCounts: [4, 4, 4, 0] }] })
      );

      expect(signals).toHaveLength(1);
      expect(signals[0].confidence).toBe(0.9);
      expect(signals[0].evidence).toContain('"Number.isNaN(b)"');
      expect(signals[0].evidence).toContain('never evaluated');
    });

    it('reports an operand once, not as both never-evaluated and never-decisive', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_OP]),
        makeCoverage({ binaryExpressions: [{ line: 19, pathCounts: [3, 3, 3, 0] }] })
      );

      const forLastOperand = signals.filter((s) => s.evidence.includes('"Number.isNaN(b)"'));
      expect(forLastOperand).toHaveLength(1);
      expect(forLastOperand[0].confidence).toBe(0.9);
    });

    it('says nothing when every operand was evaluated', () => {
      // The [3,3,3,2] signature of the real demo: fully covered by Istanbul's reckoning.
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_B, THROWS_ON_OP]),
        makeCoverage({ binaryExpressions: [{ line: 19, pathCounts: [3, 3, 3, 2] }] })
      );

      expect(signals).toEqual([]);
    });

    it('ignores a zero on the first operand — the condition was simply never reached', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_B, THROWS_ON_OP]),
        makeCoverage({ binaryExpressions: [{ line: 19, pathCounts: [0, 0, 0, 0] }] })
      );

      expect(signals).toEqual([]);
    });

    it('skips a line whose Istanbul paths do not line up with the operands', () => {
      const signals = detector.detect(
        makeCodeModel([HAPPY_PATH, THROWS_ON_A, THROWS_ON_B, THROWS_ON_OP]),
        // A nested chain of the other operator gets its own entry on the same line;
        // guessing which is which would invent findings.
        makeCoverage({ binaryExpressions: [
          { line: 19, pathCounts: [4, 4, 0] },
          { line: 19, pathCounts: [4, 0] },
        ] })
      );

      expect(signals).toEqual([]);
    });
  });
});
