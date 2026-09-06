export interface IstanbulFileCoverage {
  statementMap: Record<string, {
    start: { line: number; column: number };
    end: { line: number; column: number };
  }>;
  s: Record<string, number>;
  branchMap: Record<string, {
    loc: { start: { line: number }; end: { line: number } };
    type: string;
  }>;
  b: Record<string, number[]>;
  fnMap: Record<string, {
    name: string;
    loc: { start: { line: number }; end: { line: number } };
  }>;
  f: Record<string, number>;
}

export type IstanbulCoverageData = Record<string, IstanbulFileCoverage>;

/** Which runner produced this artifact. Written by the reporter, never inferred. */
export type TestFrameworkId = 'jest' | 'vitest';

/**
 * How the coverage data was produced. Recorded as fact from the runner's own
 * config: `v8` does not emit `binary-expr` branches, so operand-level analysis
 * is unavailable rather than empty (see `istanbul-mapper.ts`).
 */
export type CoverageProviderId = 'istanbul' | 'v8' | 'none';

export interface RuntimeData {
  framework: TestFrameworkId;
  coverageProvider: CoverageProviderId;
  /** Absolute path to the runner's coverage directory. */
  coverageDirectory: string;
  timestamp: string;
  testResults: {
    testFilePath: string;
    testName: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    /**
     * Assertions the runner actually executed. Optional because Vitest's reporter
     * API does not expose it — and `0` is not a safe stand-in: it is the only
     * consumer's truncation bound (`assertion-quality.ts:135`), so a zero would
     * discard every assertion for the test instead of deferring to the static count.
     */
    assertionCount?: number;
  }[];
}

/** @deprecated Renamed to `RuntimeData` in 0.9.0. */
export type JestRuntimeData = RuntimeData;

export interface IstanbulMethodMetrics {
  linesCovered: number;
  linesTotal: number;
  lineCoveragePercent: number;
  branchesHit: number;
  branchesTotal: number;
  branchCoveragePercent: number;
  /**
   * Per-operand evaluation counts of the method's `binary-expr` branches (`a || b`,
   * `a && b`), which the aggregate counters above flatten away. A zero proves an operand
   * was never even evaluated; a non-zero proves nothing about whether it was ever the
   * operand that decided the branch.
   *
   * Absent when the coverage provider does not measure operands (`v8`), which is
   * different from an empty array — that means Istanbul looked and this method has
   * no compound conditions.
   */
  binaryExpressions?: BinaryExprCoverage[];
}

export interface BinaryExprCoverage {
  /** Line the expression starts on — how a branch in the code model is matched to it. */
  line: number;
  /** Times each operand was evaluated, left to right. */
  pathCounts: number[];
}

export interface RuntimeTestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  assertionCount?: number;
}

export interface RuntimeMethodMetrics {
  testNames: string[];
  failedTests: string[];
  skippedTests: string[];
  perTest: RuntimeTestResult[];
}

export interface MethodCoverage {
  className: string;
  methodName: string;
  /** Human-facing `ClassName.methodName` (or `filePath.fnName` for standalone
   *  functions) — the internal Map key is file-qualified instead (task 021). */
  qualifiedName: string;
  /** 'class' for methods, 'module' for standalone functions — replaces the old
   *  key-format inference (`key === qualifiedName`). */
  ownerKind: 'class' | 'module';
  filePath: string;
  staticTests: string[];
  istanbul?: IstanbulMethodMetrics;
  runtime?: RuntimeMethodMetrics;
  isCovered: boolean;
  coverageSource: 'istanbul' | 'static';
}

/**
 * Class methods are keyed `filePath:ClassName.methodName`; standalone functions
 * `filePath:fnName` (see `CoverageKey` in types/callable.ts).
 *
 * `filePath` is required on every accessor. It used to be optional, which let a
 * call site silently fall back to a `ClassName.methodName` index — correct until
 * two files declared the same class name, at which point the lookup returned
 * nothing and each caller reinterpreted that nothing its own way (task 021).
 * Requiring it makes every such site a compile error instead. Callers holding
 * only a Reasoner-supplied class name resolve it first through
 * `resolveReasonerOwnerFile`, which fails closed on a duplicated name.
 */
export interface ResolvedCoverage {
  methods: Map<string, MethodCoverage>;
  hasIstanbulData: boolean;
  hasRuntimeData: boolean;
  coverageProvider: CoverageProviderId;
  /**
   * Whether the loaded coverage artifact records per-operand branch counts. Not derivable
   * from `coverageProvider` alone: Vitest's v8 provider emits them and Jest's does not.
   */
  measuresOperands: boolean;
  isMethodCovered(className: string, methodName: string, filePath: string): boolean;
  getMethodCoverage(className: string, methodName: string, filePath: string): MethodCoverage | undefined;
  getTestsForMethod(className: string, methodName: string, filePath: string): string[];
}
