import {
  SourceFile,
  Node,
  SyntaxKind,
  CallExpression,
  PropertyAccessExpression,
  ArrowFunction,
  Block,
  VariableDeclaration,
  ObjectLiteralExpression,
  PropertyAssignment,
  BinaryExpression,
} from 'ts-morph';
import type { TestFileNode, DescribeBlockNode, TestNode, AssertionNode } from '../types/code-model';

export function analyzeTestFile(sourceFile: SourceFile): TestFileNode {
  const filePath = sourceFile.getFilePath();
  const describes = extractDescribeBlocks(sourceFile);
  return { filePath, describes };
}

function extractDescribeBlocks(sourceFile: SourceFile): DescribeBlockNode[] {
  const describes: DescribeBlockNode[] = [];
  const callExps = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExps) {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr)) continue;
    const calleeName = expr.getText();
    if (calleeName !== 'describe') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const nameArg = args[0];
    const callbackArg = args[1];
    const name = getStringLiteralValue(nameArg);
    if (!name) continue;

    const callback = callbackArg;
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const body = callback.getBody();
    const block = Node.isBlock(body) ? (body as Block) : null;
    if (!block) continue;

    const mocks = extractMocksFromBlock(block);
    const tests = extractTestsFromBlock(block);
    for (const test of tests) {
      test.mocks = [...mocks];
    }

    describes.push({ name, tests });
  }

  return describes;
}

function getStringLiteralValue(node: Node): string | null {
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return null;
}

function extractMocksFromBlock(block: Block): string[] {
  const mocks: string[] = [];
  const callExps = block.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExps) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const pa = expr as PropertyAccessExpression;
    const obj = pa.getExpression();
    if (!Node.isIdentifier(obj)) continue;
    if (obj.getText() !== 'jest') continue;
    const methodName = pa.getName();
    if (methodName !== 'fn' && methodName !== 'spyOn') continue;

    const mockPath = getMockPathFromAncestor(call);
    if (mockPath) mocks.push(mockPath);
  }

  return [...new Set(mocks)];
}

function getMockPathFromAncestor(jestFnCall: Node): string | null {
  let node: Node | undefined = jestFnCall.getParent();
  while (node) {
    if (Node.isPropertyAssignment(node)) {
      const pa = node as PropertyAssignment;
      const propName = pa.getName();
      const objLit = node.getParent();
      if (objLit && Node.isObjectLiteralExpression(objLit)) {
        const varName = findVariableNameForObjectLiteral(objLit as ObjectLiteralExpression);
        if (varName) return `${varName}.${propName}`;
      }
    }
    node = node.getParent();
  }
  return null;
}

function findVariableNameForObjectLiteral(objLit: ObjectLiteralExpression): string | null {
  let node: Node | undefined = objLit.getParent();
  while (node) {
    if (Node.isVariableDeclaration(node)) {
      return (node as VariableDeclaration).getName();
    }
    if (Node.isBinaryExpression(node)) {
      const bin = node as BinaryExpression;
      if (bin.getOperatorToken().getText() === '=') {
        const left = bin.getLeft();
        if (Node.isIdentifier(left)) return left.getText();
      }
    }
    node = node.getParent();
  }
  return null;
}

function extractTestsFromBlock(block: Block): TestNode[] {
  const tests: TestNode[] = [];
  const statements = block.getStatements();

  for (const stmt of statements) {
    if (!Node.isExpressionStatement(stmt)) continue;
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) continue;

    const call = expr as CallExpression;
    const callExpr = call.getExpression();
    if (!Node.isIdentifier(callExpr)) continue;
    const calleeName = callExpr.getText();
    if (calleeName !== 'it' && calleeName !== 'test') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const name = getStringLiteralValue(args[0]);
    const callback = args[1];
    if (!name) continue;
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const testNode = analyzeTest(name, callback as ArrowFunction);
    tests.push(testNode);
  }

  return tests;
}

function analyzeTest(name: string, callback: ArrowFunction): TestNode {
  const body = callback.getBody();
  const block = Node.isBlock(body) ? (body as Block) : null;
  const isAsync = callback.isAsync();
  const assertions = block ? extractAssertions(block) : [];
  const targetMethod = inferTargetMethod(name, block);
  const mocks: string[] = [];

  return {
    name,
    targetMethod,
    assertions,
    mocks,
    isAsync,
  };
}

function extractAssertions(block: Block): AssertionNode[] {
  const assertions: AssertionNode[] = [];
  const callExps = block.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExps) {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr)) continue;
    if (expr.getText() !== 'expect') continue;

    const outerCall = findOuterExpectCall(call as CallExpression);
    if (!outerCall) continue;

    const outerExpr = outerCall.getExpression();
    if (!Node.isPropertyAccessExpression(outerExpr)) continue;

    const pa = outerExpr as PropertyAccessExpression;
    const chain = getExpectChain(pa);
    const { matcher, hasRejects } = chain;
    if (!matcher) continue;

    const target = getExpectTarget(call as CallExpression);
    const type = categorizeAssertion(matcher, hasRejects);
    assertions.push({ type, target, matcherUsed: matcher });
  }

  return assertions;
}

function findOuterExpectCall(expectCall: CallExpression): CallExpression | null {
  let node: Node | undefined = expectCall.getParent();
  while (node) {
    if (Node.isCallExpression(node)) return node as CallExpression;
    node = node.getParent();
  }
  return null;
}

function getExpectChain(pa: PropertyAccessExpression): { matcher: string; hasRejects: boolean } {
  let current: Node = pa;
  let matcher = '';
  let hasRejects = false;

  while (Node.isPropertyAccessExpression(current)) {
    const name = (current as PropertyAccessExpression).getName();
    if (name === 'rejects') hasRejects = true;
    else matcher = name;
    const expr = (current as PropertyAccessExpression).getExpression();
    if (Node.isCallExpression(expr)) {
      break;
    }
    current = expr;
  }

  return { matcher, hasRejects };
}

function getExpectTarget(expectCall: CallExpression): string {
  const args = expectCall.getArguments();
  if (args.length === 0) return '';
  const arg = args[0];
  return arg.getText();
}

function categorizeAssertion(matcher: string, hasRejects: boolean): AssertionNode['type'] {
  if (matcher === 'toHaveBeenCalledWith') return 'called_with';
  if (matcher === 'toHaveBeenCalled' || matcher === 'toHaveBeenCalledTimes') return 'spy_call_count';
  if (matcher === 'toThrow' && hasRejects) return 'rejects';
  if (matcher === 'toThrow' && !hasRejects) return 'throws';
  if (matcher === 'toMatchSnapshot' || matcher === 'toMatchInlineSnapshot') return 'snapshot';
  return 'value_check';
}

const TEST_UTILITY_METHODS = new Set([
  'fn', 'spyOn', 'mock', 'mockReturnValue', 'mockReturnValueOnce',
  'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce',
  'mockImplementation', 'mockImplementationOnce', 'mockClear', 'clearAllMocks', 'resetAllMocks',
  'mockReturnThis', 'mockReset', 'mockRestore',
  'toHaveBeenCalled', 'toHaveBeenCalledWith', 'toHaveBeenCalledTimes', 'toHaveBeenLastCalledWith',
  'toBe', 'toEqual', 'toStrictEqual', 'toBeDefined', 'toBeUndefined', 'toBeNull',
  'toBeTruthy', 'toBeFalsy', 'toContain', 'toHaveLength', 'toMatchObject',
  'toThrow', 'toMatchSnapshot', 'toMatchInlineSnapshot', 'toBeGreaterThan', 'toBeLessThan',
  'rejects', 'resolves', 'not', 'stringContaining', 'objectContaining', 'arrayContaining',
  'expect', 'describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'find', 'forEach', 'reduce',
  'slice', 'splice', 'concat', 'join', 'split', 'trim', 'toLowerCase', 'toUpperCase',
  'toString', 'valueOf', 'keys', 'values', 'entries', 'has', 'get', 'set', 'delete',
  'log', 'warn', 'error', 'info', 'debug',
  'stringify', 'parse', 'assign', 'freeze',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'then', 'catch', 'finally',
]);

function inferTargetMethod(testName: string, block: Block | null): string | null {
  if (!block) return null;

  const candidates = new Map<string, number>();
  const calls = block.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression();
    if (Node.isPropertyAccessExpression(expr)) {
      const pa = expr as PropertyAccessExpression;
      const methodName = pa.getName();

      if (TEST_UTILITY_METHODS.has(methodName)) continue;
      if (methodName.startsWith('mock') || methodName.startsWith('__')) continue;

      const obj = pa.getExpression();
      const objText = obj.getText();
      if (objText === 'jest' || objText === 'expect' || objText === 'console' || objText === 'JSON' || objText === 'Object' || objText === 'Array' || objText === 'Math' || objText === 'Date' || objText === 'Promise') continue;

      if (isPartOfAssertionChain(call)) continue;
      if (isDescendantOfMockChain(call)) continue;

      candidates.set(methodName, (candidates.get(methodName) ?? 0) + 1);
      continue;
    }

    if (Node.isIdentifier(expr)) {
      const functionName = expr.getText();
      if (TEST_UTILITY_METHODS.has(functionName)) continue;
      if (functionName.startsWith('mock') || functionName.startsWith('__')) continue;

      if (isPartOfAssertionChain(call)) continue;
      if (isDescendantOfMockChain(call)) continue;

      candidates.set(functionName, (candidates.get(functionName) ?? 0) + 1);
    }
  }

  if (candidates.size === 0) return null;

  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

function isPartOfAssertionChain(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isPropertyAccessExpression(current)) {
      const name = (current as PropertyAccessExpression).getName();
      if (name === 'rejects' || name === 'resolves' || name === 'not') return true;
      if (name.startsWith('toBe') || name.startsWith('toEqual') || name.startsWith('toHave') ||
          name.startsWith('toMatch') || name.startsWith('toThrow') || name.startsWith('toContain') ||
          name.startsWith('toStrictEqual')) return true;
    }
    if (Node.isCallExpression(current)) {
      const expr = (current as CallExpression).getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'expect') {
        const expectArgs = (current as CallExpression).getArguments();
        if (expectArgs.length > 0 && expectArgs[0].containsRange(node.getStart(), node.getEnd())) {
          return false;
        }
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
}

function isDescendantOfMockChain(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isPropertyAccessExpression(current)) {
      const name = (current as PropertyAccessExpression).getName();
      if (name.startsWith('mock') || name === 'fn' || name === 'spyOn') return true;
    }
    current = current.getParent();
  }
  return false;
}
