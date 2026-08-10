import {
  Node,
  SyntaxKind,
  IfStatement,
  SwitchStatement,
  ConditionalExpression,
  TryStatement,
  Block,
  BinaryExpression,
  Identifier,
  PropertyAccessExpression,
} from 'ts-morph';
import type { BranchNode, BranchOperandNode } from '../types/code-model';

type LogicalOperator = '||' | '&&';

/** Param name -> the params it derives from (`const a = Number(aRaw)` -> `a` -> `['aRaw']`). */
type AliasMap = Map<string, string[]>;

/**
 * Collects the branch points of a function body. Conditions that are `||`/`&&` chains
 * also carry their individual operands, because Istanbul's `binary-expr` counters record
 * how often each operand was *evaluated*, never which one was *decisive* — an operand can
 * be fully "covered" and still have never once decided the branch.
 */
export function collectBranches(body: Node, paramNames: string[] = []): BranchNode[] {
  const branches: BranchNode[] = [];
  const aliases = collectParamAliases(body, paramNames);

  function visit(node: Node): void {
    if (Node.isIfStatement(node)) {
      const ifStmt = node as IfStatement;
      const expression = ifStmt.getExpression();
      const guardExit = getGuardExit(ifStmt);
      branches.push({
        type: guardExit ? 'guard' : 'if',
        condition: expression.getText(),
        lineNumber: ifStmt.getStartLineNumber(),
        ...(guardExit ? { guardExit } : {}),
        ...decomposeCondition(expression, paramNames, aliases),
      });
    } else if (Node.isSwitchStatement(node)) {
      const switchStmt = node as SwitchStatement;
      branches.push({
        type: 'switch',
        condition: `switch(${switchStmt.getExpression().getText()})`,
        lineNumber: switchStmt.getStartLineNumber(),
      });
    } else if (Node.isConditionalExpression(node)) {
      const ternary = node as ConditionalExpression;
      const condition = ternary.getCondition();
      branches.push({
        type: 'ternary',
        condition: condition.getText(),
        lineNumber: ternary.getStartLineNumber(),
        ...decomposeCondition(condition, paramNames, aliases),
      });
    } else if (Node.isTryStatement(node)) {
      const tryStmt = node as TryStatement;
      branches.push({
        type: 'try_catch',
        condition: 'try/catch',
        lineNumber: tryStmt.getStartLineNumber(),
      });
    }
    node.forEachChild((child) => visit(child));
  }

  visit(body);
  return branches;
}

/** A guard clause is an `if` whose body is a single `return` or `throw`. */
export function getGuardExit(ifStmt: IfStatement): 'throw' | 'return' | null {
  const thenStmt = ifStmt.getThenStatement();
  const stmt = Node.isBlock(thenStmt)
    ? ((thenStmt as Block).getStatements().length === 1
        ? (thenStmt as Block).getStatements()[0]
        : null)
    : thenStmt;
  if (!stmt) return null;
  if (Node.isThrowStatement(stmt)) return 'throw';
  if (Node.isReturnStatement(stmt)) return 'return';
  return null;
}

/**
 * Splits a `||`/`&&` chain into its top-level operands. Returns an empty object for
 * anything else, so a simple condition carries no `operands` field at all.
 */
export function decomposeCondition(
  expression: Node,
  paramNames: string[],
  aliases: AliasMap
): { operator?: LogicalOperator; operands?: BranchOperandNode[] } {
  const flattened = flattenLogical(expression);
  if (!flattened) return {};

  return {
    operator: flattened.operator,
    operands: flattened.operands.map((operand) => ({
      text: operand.getText(),
      paramRefs: collectParamRefs(operand, paramNames, aliases),
    })),
  };
}

function unwrapParens(node: Node): Node {
  let current = node;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function getLogicalOperator(node: Node): LogicalOperator | null {
  if (!Node.isBinaryExpression(node)) return null;
  const kind = (node as BinaryExpression).getOperatorToken().getKind();
  if (kind === SyntaxKind.BarBarToken) return '||';
  if (kind === SyntaxKind.AmpersandAmpersandToken) return '&&';
  // `??` short-circuits too, but it selects a value rather than deciding a branch.
  return null;
}

/**
 * Flattens `a || b || c` (parsed as `(a || b) || c`) into `[a, b, c]`, matching how
 * Istanbul enumerates the paths of one `binary-expr`. Parentheses are transparent when
 * they wrap the same operator; a nested chain of the *other* operator stays one operand,
 * since Istanbul records it as its own `binary-expr`.
 */
function flattenLogical(expression: Node): { operator: LogicalOperator; operands: Node[] } | null {
  const root = unwrapParens(expression);
  const operator = getLogicalOperator(root);
  if (!operator) return null;

  const operands: Node[] = [];

  function walk(node: Node): void {
    const unwrapped = unwrapParens(node);
    if (getLogicalOperator(unwrapped) === operator) {
      const binary = unwrapped as BinaryExpression;
      walk(binary.getLeft());
      walk(binary.getRight());
      return;
    }
    operands.push(unwrapped);
  }

  walk(root);
  return { operator, operands };
}

/**
 * Reads the params an expression depends on. Identifiers used as property *names*
 * (`Number.isNaN` -> `isNaN`) are skipped so only real value references count.
 */
function collectParamRefs(expression: Node, paramNames: string[], aliases: AliasMap): string[] {
  if (paramNames.length === 0) return [];
  const params = new Set(paramNames);
  const refs = new Set<string>();

  for (const identifier of collectValueIdentifiers(expression)) {
    if (params.has(identifier)) {
      refs.add(identifier);
      continue;
    }
    for (const aliased of aliases.get(identifier) ?? []) {
      refs.add(aliased);
    }
  }

  return [...refs];
}

function collectValueIdentifiers(expression: Node): string[] {
  const names: string[] = [];

  const consider = (node: Node): void => {
    if (!Node.isIdentifier(node)) return;
    const parent = node.getParent();
    if (parent && Node.isPropertyAccessExpression(parent)) {
      // `obj.name` — only `obj` is a value reference.
      if ((parent as PropertyAccessExpression).getNameNode() === node) return;
    }
    if (parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return;
    names.push((node as Identifier).getText());
  };

  consider(expression);
  for (const identifier of expression.getDescendantsOfKind(SyntaxKind.Identifier)) {
    consider(identifier);
  }

  return names;
}

/**
 * Maps locals back to the params they are computed from, so an operand written against a
 * derived local (`Number.isNaN(a)` after `const a = Number(aRaw)`) still resolves to the
 * param a test would have to vary. Declarations are read in order, so a local derived
 * from an earlier local resolves transitively.
 */
export function collectParamAliases(body: Node, paramNames: string[]): AliasMap {
  const aliases: AliasMap = new Map();
  if (paramNames.length === 0) return aliases;
  const params = new Set(paramNames);

  for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    const initializer = decl.getInitializer();
    if (!initializer) continue;

    const refs = new Set<string>();
    for (const identifier of collectValueIdentifiers(initializer)) {
      if (params.has(identifier)) refs.add(identifier);
      for (const aliased of aliases.get(identifier) ?? []) refs.add(aliased);
    }

    if (refs.size > 0) aliases.set(name.getText(), [...refs]);
  }

  return aliases;
}
