import {
  SourceFile,
  Node,
  SyntaxKind,
  CallExpression,
  PropertyAccessExpression,
  ArrowFunction,
  FunctionExpression,
  Block,
  VariableDeclaration,
  ObjectLiteralExpression,
  ArrayLiteralExpression,
  PropertyAssignment,
  BinaryExpression,
  Identifier,
} from 'ts-morph';
import type {
  TestFileNode,
  DescribeBlockNode,
  TestNode,
  AssertionNode,
  ParameterizedInfo,
} from '../types/code-model';

/** Jest globals that declare a single test, including the skipped/focused aliases. */
const TEST_FN_NAMES = new Set(['it', 'test', 'xit', 'fit', 'xtest', 'ftest']);
const DESCRIBE_FN_NAMES = new Set(['describe', 'xdescribe', 'fdescribe']);
/** Chainable modifiers that do not change what the call declares (`it.only`, `it.skip.each`, ...). */
const TEST_MODIFIERS = new Set(['only', 'skip', 'concurrent', 'failing']);
/** Links in an `expect(...)` chain that wrap a matcher without being one. */
const EXPECT_MODIFIERS = new Set(['resolves', 'rejects', 'not']);
/** Above this many rows a `.each` table is recorded as one entry instead of one per case. */
const MAX_EXPANDED_CASES = 25;
/** How deep `$a.b` title tokens are resolved into object rows. */
const MAX_ROW_NESTING = 2;

type CalleeKind = 'test' | 'describe';

interface EachRow {
  /** Positional values, used for printf-style tokens (%s, %d, ...). */
  values: string[];
  /** Column/property values, used for `$name` tokens. */
  named?: Record<string, string>;
}

interface EachTable {
  form: 'array' | 'template';
  rows: EachRow[];
  /** False when the table could not be read statically (e.g. `it.each(buildCases())`). */
  resolved: boolean;
}

interface CalleeInfo {
  kind: CalleeKind;
  each: EachTable | null;
}

type TestCallback = ArrowFunction | FunctionExpression;

/** A variable that holds the subject under test, e.g. `service = new OrdersService()`. */
interface SubjectBinding {
  varName: string;
  className: string;
}

export function analyzeTestFile(sourceFile: SourceFile): TestFileNode {
  const filePath = sourceFile.getFilePath();
  const describes = extractDescribeBlocks(sourceFile);
  return { filePath, describes };
}

function extractDescribeBlocks(sourceFile: SourceFile): DescribeBlockNode[] {
  const describes: DescribeBlockNode[] = [];
  const subjectBindings = collectSubjectBindings(sourceFile);
  const callExps = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExps) {
    const callee = resolveCallee(call);
    if (!callee || callee.kind !== 'describe') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const name = getTitle(args[0]);
    if (!name) continue;

    const callback = args[1];
    if (!isTestCallback(callback)) continue;

    const body = callback.getBody();
    const block = Node.isBlock(body) ? (body as Block) : null;
    if (!block) continue;

    const mocks = extractMocksFromBlock(block);
    const { subjectVars, targetClass } = resolveTargetClass(call, name, subjectBindings);
    const tests = extractTestsFromBlock(block, subjectVars, targetClass);
    for (const test of tests) {
      test.mocks = [...mocks];
    }

    // `describe.each` runs the whole block once per row. Expanding it here would
    // duplicate every nested test and its assertions, so the block is recorded once
    // with the raw title template and the number of cases it runs.
    const parameterized = callee.each ? buildParameterizedInfo(callee.each, name) : undefined;

    describes.push({ name, tests, ...(parameterized ? { parameterized } : {}) });
  }

  return describes;
}

/* ------------------------------------------------------------------ *
 * Callee resolution (`it`, `it.only`, `it.each([...])`, `it.each` ``)  *
 * ------------------------------------------------------------------ */

function resolveNameChain(node: Node): { kind: CalleeKind; names: string[] } | null {
  const names: string[] = [];
  let current: Node = node;

  while (Node.isPropertyAccessExpression(current)) {
    names.unshift((current as PropertyAccessExpression).getName());
    current = (current as PropertyAccessExpression).getExpression();
  }

  if (!Node.isIdentifier(current)) return null;
  const base = (current as Identifier).getText();
  if (TEST_FN_NAMES.has(base)) return { kind: 'test', names };
  if (DESCRIBE_FN_NAMES.has(base)) return { kind: 'describe', names };
  return null;
}

function isModifierOnlyChain(names: string[]): boolean {
  return names.every((n) => TEST_MODIFIERS.has(n));
}

function isEachChain(names: string[]): boolean {
  return (
    names.length > 0 &&
    names[names.length - 1] === 'each' &&
    isModifierOnlyChain(names.slice(0, -1))
  );
}

/**
 * Classifies a call expression as a test/describe declaration, if it is one.
 * Handles `it(...)`, `it.only(...)`, `it.each([...])(...)` and ``it.each`...`(...)``.
 */
function resolveCallee(call: CallExpression): CalleeInfo | null {
  const expr = call.getExpression();

  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    const chain = resolveNameChain(expr);
    if (!chain || !isModifierOnlyChain(chain.names)) return null;
    return { kind: chain.kind, each: null };
  }

  // Array form: the callee is itself the call `it.each([...])`.
  if (Node.isCallExpression(expr)) {
    const inner = expr as CallExpression;
    const chain = resolveNameChain(inner.getExpression());
    if (!chain || !isEachChain(chain.names)) return null;
    return { kind: chain.kind, each: buildEachFromArray(inner.getArguments()[0]) };
  }

  // Tagged-template form: the callee is ``it.each`table` ``.
  if (Node.isTaggedTemplateExpression(expr)) {
    const chain = resolveNameChain(expr.getTag());
    if (!chain || !isEachChain(chain.names)) return null;
    return { kind: chain.kind, each: buildEachFromTemplate(expr.getTemplate()) };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * `.each` tables                                                      *
 * ------------------------------------------------------------------ */

function buildEachFromArray(rowsArg: Node | undefined): EachTable {
  const arrayLit = resolveArrayLiteral(rowsArg);
  if (!arrayLit) return { form: 'array', rows: [], resolved: false };

  const rows: EachRow[] = [];
  for (const element of arrayLit.getElements()) {
    // A spread hides rows we cannot enumerate, so the table is not expandable.
    if (Node.isSpreadElement(element)) return { form: 'array', rows: [], resolved: false };

    if (Node.isArrayLiteralExpression(element)) {
      rows.push({ values: element.getElements().map(literalText) });
      continue;
    }
    if (Node.isObjectLiteralExpression(element)) {
      rows.push({ values: [literalText(element)], named: objectRowProperties(element) });
      continue;
    }
    rows.push({ values: [literalText(element)] });
  }

  return { form: 'array', rows, resolved: true };
}

/** Flattens an object row, keeping dotted keys so `$user.name` resolves like Jest does. */
function objectRowProperties(
  objLit: ObjectLiteralExpression,
  prefix = '',
  depth = 0
): Record<string, string> {
  const named: Record<string, string> = {};

  for (const prop of objLit.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const initializer = prop.getInitializer();
      if (!initializer) continue;
      const key = `${prefix}${prop.getName()}`;
      named[key] = literalText(initializer);
      const nested = unwrapExpression(initializer);
      if (Node.isObjectLiteralExpression(nested) && depth < MAX_ROW_NESTING) {
        Object.assign(named, objectRowProperties(nested as ObjectLiteralExpression, `${key}.`, depth + 1));
      }
      continue;
    }
    if (Node.isShorthandPropertyAssignment(prop)) {
      named[`${prefix}${prop.getName()}`] = prop.getName();
    }
  }

  return named;
}

function resolveArrayLiteral(node: Node | undefined): ArrayLiteralExpression | null {
  if (!node) return null;
  const unwrapped = unwrapExpression(node);
  if (Node.isArrayLiteralExpression(unwrapped)) return unwrapped as ArrayLiteralExpression;
  if (Node.isIdentifier(unwrapped)) return findArrayInitializer(unwrapped as Identifier);
  return null;
}

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** Follows `it.each(CASES)` back to a `const CASES = [...]` in an enclosing scope. */
function findArrayInitializer(id: Identifier): ArrayLiteralExpression | null {
  const name = id.getText();
  let scope: Node | undefined = id.getParent();

  while (scope) {
    if (Node.isBlock(scope) || Node.isSourceFile(scope)) {
      for (const stmt of scope.getStatements()) {
        if (!Node.isVariableStatement(stmt)) continue;
        for (const decl of stmt.getDeclarations()) {
          if (decl.getName() !== name) continue;
          const initializer = decl.getInitializer();
          if (!initializer) return null;
          const unwrapped = unwrapExpression(initializer);
          return Node.isArrayLiteralExpression(unwrapped)
            ? (unwrapped as ArrayLiteralExpression)
            : null;
        }
      }
    }
    scope = scope.getParent();
  }

  return null;
}

/**
 * Reads a tagged-template table:
 *
 *   it.each`
 *     a    | b    | expected
 *     ${1} | ${2} | ${3}
 *   `('$a + $b', ...)
 *
 * The first non-empty line names the columns, every later line is a case.
 */
function buildEachFromTemplate(template: Node): EachTable {
  const parts: Array<{ text: string; isValue: boolean }> = [];

  if (Node.isNoSubstitutionTemplateLiteral(template)) {
    parts.push({ text: template.getLiteralText(), isValue: false });
  } else if (Node.isTemplateExpression(template)) {
    parts.push({ text: template.getHead().getLiteralText(), isValue: false });
    for (const span of template.getTemplateSpans()) {
      parts.push({ text: literalText(span.getExpression()), isValue: true });
      parts.push({ text: span.getLiteral().getLiteralText(), isValue: false });
    }
  } else {
    return { form: 'template', rows: [], resolved: false };
  }

  const lines: string[][] = [[]];
  let cell = '';
  const pushCell = () => {
    lines[lines.length - 1].push(cell.trim());
    cell = '';
  };

  for (const part of parts) {
    if (part.isValue) {
      cell += part.text;
      continue;
    }
    for (const char of part.text) {
      if (char === '\n') {
        pushCell();
        lines.push([]);
      } else if (char === '|') {
        pushCell();
      } else {
        cell += char;
      }
    }
  }
  pushCell();

  const populated = lines.filter((cells) => cells.some((c) => c.length > 0));
  if (populated.length === 0) return { form: 'template', rows: [], resolved: false };

  const header = populated[0];
  const rows: EachRow[] = populated.slice(1).map((cells) => {
    const named: Record<string, string> = {};
    header.forEach((column, i) => {
      if (column) named[column] = cells[i] ?? '';
    });
    return { values: cells, named };
  });

  return { form: 'template', rows, resolved: true };
}

/**
 * Substitutes Jest's title tokens for one row: printf-style (%s, %d, %#, ...)
 * consumed positionally, then `$name` / `$#` for object and template rows.
 */
function interpolateEachTitle(titleTemplate: string, row: EachRow, index: number): string {
  let valueIndex = 0;
  let title = titleTemplate.replace(/%([sdifjop#%])/g, (match, token: string) => {
    if (token === '%') return '%';
    if (token === '#') return String(index);
    const value = row.values[valueIndex++];
    return value === undefined ? match : value;
  });

  if (row.named) {
    title = title.replace(/\$([#\w]+(?:\.\w+)*)/g, (match, ref: string) => {
      if (ref === '#') return String(index);
      const direct = row.named?.[ref];
      if (direct !== undefined) return direct;
      const base = row.named?.[ref.split('.')[0]];
      return base !== undefined ? base : match;
    });
  }

  return title;
}

function buildParameterizedInfo(each: EachTable, titleTemplate: string): ParameterizedInfo {
  return { form: each.form, titleTemplate, caseCount: each.rows.length };
}

function shouldExpandCases(each: EachTable): boolean {
  return each.resolved && each.rows.length > 0 && each.rows.length <= MAX_EXPANDED_CASES;
}

/* ------------------------------------------------------------------ *
 * Titles, mocks                                                       *
 * ------------------------------------------------------------------ */

function getTitle(node: Node): string | null {
  const literal = getStringLiteralValue(node);
  if (literal !== null) return literal;
  // `.each` titles are occasionally built from a template literal; keep the raw text.
  if (Node.isTemplateExpression(node)) return node.getText().slice(1, -1);
  return null;
}

function getStringLiteralValue(node: Node): string | null {
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return null;
}

function literalText(node: Node): string {
  const value = getStringLiteralValue(node);
  if (value !== null) return value;
  return node.getText().replace(/\s+/g, ' ');
}

function isTestCallback(node: Node): node is TestCallback {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
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

/* ------------------------------------------------------------------ *
 * Tests                                                               *
 * ------------------------------------------------------------------ */

function extractTestsFromBlock(
  block: Block,
  subjectVars: Set<string>,
  targetClass: string | null
): TestNode[] {
  const tests: TestNode[] = [];

  for (const stmt of block.getStatements()) {
    if (!Node.isExpressionStatement(stmt)) continue;
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) continue;

    const call = expr as CallExpression;
    const callee = resolveCallee(call);
    if (!callee || callee.kind !== 'test') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const title = getTitle(args[0]);
    const callback = args[1];
    if (!title) continue;
    if (!isTestCallback(callback)) continue;

    if (!callee.each) {
      tests.push(analyzeTest(title, title, callback, subjectVars, targetClass));
      continue;
    }

    const info = buildParameterizedInfo(callee.each, title);
    if (!shouldExpandCases(callee.each)) {
      // Table could not be read statically (or is very large): keep one entry that
      // carries the raw title template, so the assertions still reach the inventory.
      tests.push({
        ...analyzeTest(title, title, callback, subjectVars, targetClass),
        parameterized: info,
      });
      continue;
    }

    callee.each.rows.forEach((row, index) => {
      const caseName = interpolateEachTitle(title, row, index);
      tests.push({
        ...analyzeTest(caseName, title, callback, subjectVars, targetClass),
        parameterized: { ...info, caseIndex: index },
      });
    });
  }

  return tests;
}

/**
 * @param name         canonical name recorded in the inventory (a `.each` case name)
 * @param titleForHint title used to infer the target method — the raw template for
 *                     `.each`, so per-row values do not skew the match
 */
function analyzeTest(
  name: string,
  titleForHint: string,
  callback: TestCallback,
  subjectVars: Set<string>,
  targetClass: string | null
): TestNode {
  const body = callback.getBody();
  // Concise arrow bodies (`it('x', () => expect(...).toBe(1))`) carry assertions too.
  const scope = Node.isBlock(body) ? (body as Block) : body;
  const isAsync = callback.isAsync();
  const assertions = extractAssertions(scope);
  const targetMethod = inferTargetMethod(titleForHint, scope, subjectVars);
  const targetCallArgs = targetMethod ? findTargetCallArgs(scope, targetMethod) : null;
  const mocks: string[] = [];

  return {
    name,
    targetMethod,
    assertions,
    mocks,
    isAsync,
    targetClass,
    ...(targetCallArgs ? { targetCallArgs } : {}),
  };
}

/**
 * Reads the arguments the test passes to the method under test. Which argument a test
 * varies is the only static evidence of *which* operand of a compound condition it can
 * have made decisive, so the values are kept as written.
 */
function findTargetCallArgs(scope: Node, targetMethod: string): string[] | null {
  for (const call of getCallExpressions(scope)) {
    const expr = call.getExpression();
    const name = Node.isPropertyAccessExpression(expr)
      ? (expr as PropertyAccessExpression).getName()
      : Node.isIdentifier(expr)
        ? expr.getText()
        : null;
    if (name !== targetMethod) continue;
    if (isDescendantOfMockChain(call)) continue;
    return call.getArguments().map(literalText);
  }
  return null;
}

function extractAssertions(scope: Node): AssertionNode[] {
  const assertions: AssertionNode[] = [];

  for (const call of getCallExpressions(scope)) {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr)) continue;
    if (expr.getText() !== 'expect') continue;

    const outerCall = findOuterExpectCall(call);
    if (!outerCall) continue;

    const outerExpr = outerCall.getExpression();
    if (!Node.isPropertyAccessExpression(outerExpr)) continue;

    const pa = outerExpr as PropertyAccessExpression;
    const chain = getExpectChain(pa);
    const { matcher, hasRejects } = chain;
    if (!matcher) continue;

    const target = getExpectTarget(call);
    const type = categorizeAssertion(matcher, hasRejects);
    assertions.push({ type, target, matcherUsed: matcher });
  }

  return assertions;
}

function getCallExpressions(scope: Node): CallExpression[] {
  const calls = scope.getDescendantsOfKind(SyntaxKind.CallExpression);
  if (Node.isCallExpression(scope)) calls.unshift(scope as CallExpression);
  return calls;
}

function findOuterExpectCall(expectCall: CallExpression): CallExpression | null {
  let node: Node | undefined = expectCall.getParent();
  while (node) {
    if (Node.isCallExpression(node)) return node as CallExpression;
    node = node.getParent();
  }
  return null;
}

/**
 * Walk an `expect(...)` chain from the outside in and report the matcher that
 * actually does the checking.
 *
 * The chain is `expect(x).<modifier>*.<matcher>`, so the outermost property
 * access is the matcher and everything nested inside it is a modifier. Only
 * `resolves` / `rejects` / `not` may appear as modifiers; recording one of them
 * as `matcherUsed` (as this used to do for `resolves` and `not`) hides the real
 * matcher from every strength classifier downstream.
 */
function getExpectChain(pa: PropertyAccessExpression): { matcher: string; hasRejects: boolean } {
  let current: Node = pa;
  let matcher = '';
  let hasRejects = false;

  while (Node.isPropertyAccessExpression(current)) {
    const name = (current as PropertyAccessExpression).getName();
    if (name === 'rejects') hasRejects = true;
    // The outermost non-modifier name is the matcher; `resolves`/`not` sit
    // between it and `expect(...)` and must not overwrite it.
    else if (!EXPECT_MODIFIERS.has(name) && !matcher) matcher = name;
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
  // Any `rejects.*` chain asserts on an error path, not just `rejects.toThrow`.
  if (hasRejects) return 'rejects';
  if (matcher === 'toThrow') return 'throws';
  if (matcher === 'toMatchSnapshot' || matcher === 'toMatchInlineSnapshot') return 'snapshot';
  return 'value_check';
}

/* ------------------------------------------------------------------ *
 * Target method inference                                             *
 * ------------------------------------------------------------------ */

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

const GLOBAL_RECEIVERS = new Set([
  'jest', 'expect', 'console', 'JSON', 'Object', 'Array', 'Math', 'Date', 'Promise',
]);

/** How much a single call counts towards being the method the test targets. */
const ROLE_WEIGHTS = { act: 3, assert: 2, post: 1.5, arrange: 0.5 } as const;

type CallRole = keyof typeof ROLE_WEIGHTS;

interface Candidate {
  name: string;
  weight: number;
  onSubject: boolean;
}

interface CallOccurrence {
  name: string;
  role: CallRole;
  onSubject: boolean;
  /** Position of the call in the test body; helper calls report their call site. */
  start: number;
}

/** How far to follow test-local helper functions when looking for the real call. */
const MAX_HELPER_DEPTH = 2;

/**
 * Picks the method a test exercises. The first call in the body is a poor proxy —
 * it is usually setup — so candidates are ranked by, in order: a match against the
 * test title, being called on the subject under test, and the role their calls play
 * (act > assertion target > post-assertion > arrange).
 */
function inferTargetMethod(
  testName: string,
  scope: Node | null,
  subjectVars: Set<string>
): string | null {
  if (!scope) return null;

  const occurrences = collectCallOccurrences(scope, subjectVars);
  if (occurrences.length === 0) return null;

  const candidates = new Map<string, Candidate>();
  for (const occurrence of occurrences) {
    const existing = candidates.get(occurrence.name);
    candidates.set(occurrence.name, {
      name: occurrence.name,
      weight: (existing?.weight ?? 0) + ROLE_WEIGHTS[occurrence.role],
      onSubject: (existing?.onSubject ?? false) || occurrence.onSubject,
    });
  }

  // The last setup-phase call is the "act" of an arrange/act/assert test.
  const lastArrange = occurrences
    .filter((o) => o.role === 'arrange')
    .reduce<CallOccurrence | null>((acc, cur) => (acc === null || cur.start > acc.start ? cur : acc), null);
  if (lastArrange) {
    const candidate = candidates.get(lastArrange.name);
    if (candidate) {
      candidate.weight += ROLE_WEIGHTS.act - ROLE_WEIGHTS.arrange;
    }
  }

  const titleTokens = tokenizeTitle(testName);
  const ranked = [...candidates.values()].sort((a, b) => {
    const titleDiff = Number(matchesTitle(b.name, titleTokens)) - Number(matchesTitle(a.name, titleTokens));
    if (titleDiff !== 0) return titleDiff;
    const subjectDiff = Number(b.onSubject) - Number(a.onSubject);
    if (subjectDiff !== 0) return subjectDiff;
    return b.weight - a.weight;
  });

  return ranked[0].name;
}

/**
 * Lists the calls in a test body that could name the method under test. Calls to
 * helpers declared in the test file itself (`const order = (p) => service.createOrder(p)`)
 * are replaced by the calls inside the helper, which is what the test really exercises.
 */
function collectCallOccurrences(
  scope: Node,
  subjectVars: Set<string>,
  depth = 0,
  visited: Set<string> = new Set(),
  roleOverride?: CallRole
): CallOccurrence[] {
  const occurrences: CallOccurrence[] = [];
  const firstAssertionStart = roleOverride ? Number.POSITIVE_INFINITY : getFirstAssertionStart(scope);

  for (const call of getCallExpressions(scope)) {
    const expr = call.getExpression();
    let name: string | null = null;
    let onSubject = false;

    if (Node.isPropertyAccessExpression(expr)) {
      const pa = expr as PropertyAccessExpression;
      name = pa.getName();
      const receiver = pa.getExpression();
      if (GLOBAL_RECEIVERS.has(receiver.getText())) continue;
      onSubject = subjectVars.has(getRootIdentifierName(receiver) ?? '');
    } else if (Node.isIdentifier(expr)) {
      name = expr.getText();
    }

    if (!name) continue;
    if (TEST_UTILITY_METHODS.has(name)) continue;
    if (name.startsWith('mock') || name.startsWith('__')) continue;
    if (isPartOfAssertionChain(call)) continue;
    if (isDescendantOfMockChain(call)) continue;

    const role = roleOverride ?? classifyCallRole(call, firstAssertionStart);

    if (Node.isIdentifier(expr) && depth < MAX_HELPER_DEPTH && !visited.has(name)) {
      const helperBody = findLocalFunctionBody(expr as Identifier);
      if (helperBody) {
        const inner = collectCallOccurrences(
          helperBody,
          subjectVars,
          depth + 1,
          new Set([...visited, name]),
          role
        );
        for (const occurrence of inner) {
          occurrences.push({ ...occurrence, start: call.getStart() });
        }
        continue;
      }
    }

    occurrences.push({ name, role, onSubject, start: call.getStart() });
  }

  return occurrences;
}

/** Resolves an identifier to a function declared in the same file, if there is one. */
function findLocalFunctionBody(id: Identifier): Node | null {
  const name = id.getText();
  let scope: Node | undefined = id.getParent();

  while (scope) {
    if (Node.isBlock(scope) || Node.isSourceFile(scope)) {
      for (const stmt of scope.getStatements()) {
        if (Node.isFunctionDeclaration(stmt) && stmt.getName() === name) {
          return stmt.getBody() ?? null;
        }
        if (!Node.isVariableStatement(stmt)) continue;
        for (const decl of stmt.getDeclarations()) {
          if (decl.getName() !== name) continue;
          const initializer = decl.getInitializer();
          if (!initializer) return null;
          const unwrapped = unwrapExpression(initializer);
          return isTestCallback(unwrapped) ? unwrapped.getBody() : null;
        }
      }
    }
    scope = scope.getParent();
  }

  return null;
}

function getRootIdentifierName(node: Node): string | null {
  let current: Node = node;
  while (Node.isPropertyAccessExpression(current) || Node.isCallExpression(current)) {
    current = current.getExpression();
  }
  return Node.isIdentifier(current) ? current.getText() : null;
}

function getFirstAssertionStart(scope: Node): number {
  let first = Number.POSITIVE_INFINITY;
  for (const call of getCallExpressions(scope)) {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== 'expect') continue;
    first = Math.min(first, call.getStart());
  }
  return first;
}

function classifyCallRole(call: CallExpression, firstAssertionStart: number): CallRole {
  if (isInsideExpectArgument(call)) return 'assert';
  if (call.getStart() < firstAssertionStart) return 'arrange';
  return 'post';
}

function isInsideExpectArgument(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isCallExpression(current)) {
      const expr = (current as CallExpression).getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'expect') {
        const args = (current as CallExpression).getArguments();
        return args.length > 0 && args[0].containsRange(node.getStart(), node.getEnd());
      }
    }
    current = current.getParent();
  }
  return false;
}

function tokenizeTitle(testName: string): string[] {
  return testName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function splitIdentifierWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when every word of the method name shows up in the test title. */
function matchesTitle(methodName: string, titleTokens: string[]): boolean {
  const words = splitIdentifierWords(methodName);
  if (words.length === 0 || titleTokens.length === 0) return false;
  return words.every((word) => titleTokens.some((token) => wordMatchesToken(word, token)));
}

/** Exact match for short words, shared-stem match for longer ones ("reserve" ~ "reservation"). */
function wordMatchesToken(word: string, token: string): boolean {
  if (word.length < 4) return word === token;
  if (word === token) return true;
  const required = Math.max(4, word.length - 2);
  let shared = 0;
  while (shared < word.length && shared < token.length && word[shared] === token[shared]) {
    shared += 1;
  }
  return shared >= required;
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

/* ------------------------------------------------------------------ *
 * Subject-under-test detection                                        *
 * ------------------------------------------------------------------ */

/**
 * Finds variables bound to a class instance — `new OrdersService()`,
 * `module.get(OrdersService)`, `TestBed.inject(OrdersService)` — so calls on the
 * subject can outrank calls on its collaborators.
 */
function collectSubjectBindings(sourceFile: SourceFile): SubjectBinding[] {
  const bindings: SubjectBinding[] = [];

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = decl.getInitializer();
    const className = initializer ? getConstructedClassName(initializer) : null;
    if (className) bindings.push({ varName: decl.getName(), className });
  }

  for (const bin of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getText() !== '=') continue;
    const left = bin.getLeft();
    if (!Node.isIdentifier(left)) continue;
    const className = getConstructedClassName(bin.getRight());
    if (className) bindings.push({ varName: left.getText(), className });
  }

  return bindings;
}

const INJECTOR_METHODS = new Set(['get', 'inject', 'resolve', 'select']);

function getConstructedClassName(node: Node): string | null {
  const expr = unwrapExpression(stripAwait(node));

  if (Node.isNewExpression(expr)) {
    const target = expr.getExpression();
    return Node.isIdentifier(target) ? target.getText() : null;
  }

  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return null;
    if (!INJECTOR_METHODS.has((callee as PropertyAccessExpression).getName())) return null;
    const arg = expr.getArguments()[0];
    if (arg && Node.isIdentifier(arg)) return arg.getText();
    const typeArg = expr.getTypeArguments()[0];
    return typeArg ? typeArg.getText() : null;
  }

  return null;
}

function stripAwait(node: Node): Node {
  return Node.isAwaitExpression(node) ? node.getExpression() : node;
}

interface TargetClassResolution {
  subjectVars: Set<string>;
  targetClass: string | null;
}

/**
 * Matches a describe block (or its ancestors, for nested blocks) against the
 * classes constructed in the file, and resolves which class the block's tests
 * target — used downstream to stop same-named methods on unrelated classes from
 * getting credit for each other's tests.
 *
 * A `new ClassName()` / `TestBed.inject(ClassName)` binding is the strongest
 * signal (verified by actual construction) and is tried first. When no binding
 * matches — e.g. a `beforeEach(() => { service = createService() })` factory
 * that never names the class directly — this falls back to the outermost
 * `describe` block's title, the idiomatic `describe('ClassName', () => {
 * describe('#method', ...) })` convention. A file with multiple un-bound
 * subjects sharing one outer `describe` can still resolve to the wrong class;
 * that is an accepted trade-off, still strictly tighter than no check at all.
 */
function resolveTargetClass(
  describeCall: CallExpression,
  describeName: string,
  bindings: SubjectBinding[]
): TargetClassResolution {
  const names = [describeName, ...getAncestorDescribeNames(describeCall)];
  const subjectVars = new Set<string>();
  let targetClass: string | null = null;

  for (const name of names) {
    for (const binding of bindings) {
      if (binding.className.toLowerCase() === name.trim().toLowerCase()) {
        subjectVars.add(binding.varName);
        if (!targetClass) targetClass = binding.className;
      }
    }
    if (subjectVars.size > 0) break;
  }

  if (!targetClass) {
    const outermost = names[names.length - 1]?.trim();
    targetClass = outermost || null;
  }

  return { subjectVars, targetClass };
}

function getAncestorDescribeNames(describeCall: CallExpression): string[] {
  const names: string[] = [];
  let current: Node | undefined = describeCall.getParent();

  while (current) {
    if (Node.isCallExpression(current)) {
      const callee = resolveCallee(current as CallExpression);
      if (callee?.kind === 'describe') {
        const title = getTitle((current as CallExpression).getArguments()[0]);
        if (title) names.push(title);
      }
    }
    current = current.getParent();
  }

  return names;
}
