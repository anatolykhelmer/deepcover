export interface CodeModel {
  modules: ModuleNode[];
  dependencyGraph: DependencyEdge[];
  testInventory: TestInventory;
}

export interface ModuleNode {
  filePath: string;
  classes: ClassNode[];
  functions?: FunctionNode[];
}

export interface ClassNode {
  name: string;
  type: 'controller' | 'service' | 'gateway' | 'module' | 'dto' | 'other';
  methods: MethodNode[];
  dependencies: string[];
  states: StateNode[];
}

export interface MethodNode {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  params: ParamNode[];
  returnType: string;
  branches: BranchNode[];
  branchCount: number;
  throwsErrors: boolean;
  hasAsyncOps: boolean;
  externalCalls: string[];
  internalCalls: string[];
  startLine: number;
  endLine: number;
}

export interface FunctionNode {
  name: string;
  visibility: 'public';
  params: ParamNode[];
  returnType: string;
  branches: BranchNode[];
  branchCount: number;
  throwsErrors: boolean;
  hasAsyncOps: boolean;
  externalCalls: string[];
  internalCalls: string[];
  startLine: number;
  endLine: number;
}

export interface ParamNode {
  name: string;
  type: string;
  isOptional: boolean;
}

export interface StateNode {
  source: 'enum' | 'union_type' | 'conditional' | 'param_validation';
  name: string;
  values: string[];
  affectedMethods: string[];
}

export interface BranchNode {
  type: 'if' | 'switch' | 'ternary' | 'try_catch' | 'guard';
  condition: string;
  lineNumber: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'injection' | 'method_call' | 'import';
}

export interface TestInventory {
  testFiles: TestFileNode[];
  coverage: Record<string, string[]>; // methodName -> testNames[]
}

export interface TestFileNode {
  filePath: string;
  describes: DescribeBlockNode[];
}

export interface DescribeBlockNode {
  name: string;
  tests: TestNode[];
  /** Set when the block comes from `describe.each`; `name` is then the title template. */
  parameterized?: ParameterizedInfo;
}

export interface TestNode {
  name: string;
  targetMethod: string | null;
  assertions: AssertionNode[];
  mocks: string[];
  isAsync: boolean;
  /** Set when the test comes from `it.each` / `test.each`. */
  parameterized?: ParameterizedInfo;
}

export interface ParameterizedInfo {
  /** `array` for `it.each([...])`, `template` for the tagged-template table form. */
  form: 'array' | 'template';
  /** Title as written, before per-case token substitution. */
  titleTemplate: string;
  /** Rows in the table; 0 when the table could not be read statically. */
  caseCount: number;
  /** Row this entry stands for; absent when one entry covers every case. */
  caseIndex?: number;
}

export interface AssertionNode {
  type: 'value_check' | 'called_with' | 'throws' | 'rejects' | 'snapshot' | 'spy_call_count' | 'other';
  target: string;
  matcherUsed: string;
}
