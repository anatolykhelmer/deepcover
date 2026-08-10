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

export interface JestRuntimeData {
  testResults: {
    testFilePath: string;
    testName: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    assertionCount: number;
  }[];
  timestamp: string;
}

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
   */
  binaryExpressions: BinaryExprCoverage[];
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
  assertionCount: number;
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
  qualifiedName: string;
  filePath: string;
  staticTests: string[];
  istanbul?: IstanbulMethodMetrics;
  runtime?: RuntimeMethodMetrics;
  isCovered: boolean;
  coverageSource: 'istanbul' | 'static';
}

export interface ResolvedCoverage {
  methods: Map<string, MethodCoverage>;
  hasIstanbulData: boolean;
  hasRuntimeData: boolean;
  isMethodCovered(className: string, methodName: string): boolean;
  getMethodCoverage(className: string, methodName: string): MethodCoverage | undefined;
  getTestsForMethod(className: string, methodName: string): string[];
}
