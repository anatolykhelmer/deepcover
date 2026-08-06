import {
  SourceFile,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
  Node,
  SyntaxKind,
  IfStatement,
  SwitchStatement,
  ConditionalExpression,
  TryStatement,
  Block,
  PropertyAccessExpression,
  CallExpression,
  VariableStatement,
} from 'ts-morph';
import type { FunctionNode, BranchNode, ParamNode } from '../types/code-model';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

interface FunctionCandidate {
  name: string;
  node: FunctionLike;
}

export function analyzeFunctions(sourceFile: SourceFile): FunctionNode[] {
  const candidates = collectExportedFunctions(sourceFile);
  const functionNames = new Set(candidates.map((candidate) => candidate.name));
  return candidates.map((candidate) => analyzeFunction(candidate, functionNames));
}

function collectExportedFunctions(sourceFile: SourceFile): FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (!name) continue;
    candidates.push({ name, node: fn });
  }

  for (const stmt of sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    candidates.push(...getExportedVariableFunctions(stmt));
  }

  return candidates;
}

function getExportedVariableFunctions(stmt: VariableStatement): FunctionCandidate[] {
  const result: FunctionCandidate[] = [];

  for (const decl of stmt.getDeclarations()) {
    const name = decl.getName();
    const initializer = decl.getInitializer();
    if (!initializer) continue;

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      result.push({ name, node: initializer });
    }
  }

  return result;
}

function analyzeFunction(candidate: FunctionCandidate, functionNames: Set<string>): FunctionNode {
  const { name, node } = candidate;
  const params: ParamNode[] = node.getParameters().map((p) => ({
    name: p.getName(),
    type: p.getTypeNode()?.getText() ?? 'unknown',
    isOptional: p.isOptional(),
  }));
  const paramToType = new Map(params.map((param) => [param.name, param.type]));
  const returnType = node.getReturnTypeNode()?.getText() ?? 'void';

  const body = node.getBody();
  const branches = body ? collectBranches(body) : [];
  const branchCount = branches.length;
  const hasAsyncOps = node.isAsync() || (body ? hasAwait(body) : false);
  const throwsErrors = body ? hasThrow(body) : false;
  const externalCalls = body ? collectExternalCalls(body, paramToType) : [];
  const internalCalls = body ? collectInternalCalls(body, functionNames, name) : [];

  return {
    name,
    visibility: 'public',
    params,
    returnType,
    branches,
    branchCount,
    throwsErrors,
    hasAsyncOps,
    externalCalls,
    internalCalls,
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
  };
}

function collectBranches(body: Node): BranchNode[] {
  const branches: BranchNode[] = [];

  function visit(node: Node): void {
    if (Node.isIfStatement(node)) {
      const ifStmt = node as IfStatement;
      const branchType = isGuardClause(ifStmt) ? 'guard' : 'if';
      branches.push({
        type: branchType,
        condition: ifStmt.getExpression().getText(),
        lineNumber: ifStmt.getStartLineNumber(),
      });
    } else if (Node.isSwitchStatement(node)) {
      const switchStmt = node as SwitchStatement;
      const expr = switchStmt.getExpression().getText();
      branches.push({
        type: 'switch',
        condition: `switch(${expr})`,
        lineNumber: switchStmt.getStartLineNumber(),
      });
    } else if (Node.isConditionalExpression(node)) {
      const ternary = node as ConditionalExpression;
      branches.push({
        type: 'ternary',
        condition: ternary.getCondition().getText(),
        lineNumber: ternary.getStartLineNumber(),
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

function isGuardClause(ifStmt: IfStatement): boolean {
  const thenStmt = ifStmt.getThenStatement();
  if (Node.isBlock(thenStmt)) {
    const block = thenStmt as Block;
    const stmts = block.getStatements();
    if (stmts.length !== 1) return false;
    const stmt = stmts[0];
    return Node.isReturnStatement(stmt) || Node.isThrowStatement(stmt);
  }
  return Node.isReturnStatement(thenStmt) || Node.isThrowStatement(thenStmt);
}

function hasAwait(node: Node): boolean {
  let found = false;
  node.forEachChild((child) => {
    if (Node.isAwaitExpression(child)) found = true;
    else found = found || hasAwait(child);
  });
  return found;
}

function hasThrow(node: Node): boolean {
  let found = false;
  node.forEachChild((child) => {
    if (Node.isThrowStatement(child)) found = true;
    else found = found || hasThrow(child);
  });
  return found;
}

function collectExternalCalls(body: Node, paramToType: Map<string, string>): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();

  function visit(node: Node): void {
    if (Node.isCallExpression(node)) {
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const pa = expr as PropertyAccessExpression;
        const obj = pa.getExpression();
        if (Node.isIdentifier(obj)) {
          const typeName = paramToType.get(obj.getText());
          if (typeName) {
            const key = `${typeName}.${pa.getName()}`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push(key);
            }
          }
        }
      }
    }

    node.forEachChild((child) => visit(child));
  }

  visit(body);
  return calls;
}

function collectInternalCalls(body: Node, functionNames: Set<string>, currentFunctionName: string): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();

  function visit(node: Node): void {
    if (Node.isCallExpression(node)) {
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (Node.isIdentifier(expr)) {
        const calledName = expr.getText();
        if (
          calledName !== currentFunctionName
          && functionNames.has(calledName)
          && !seen.has(calledName)
          && !calledName.startsWith('_')
          && !isUtilityCall(calledName)
        ) {
          seen.add(calledName);
          calls.push(calledName);
        }
      }
    }

    node.forEachChild((child) => visit(child));
  }

  visit(body);
  return calls;
}

function isUtilityCall(name: string): boolean {
  const utilities = new Set([
    'Promise',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
  ]);
  return utilities.has(name);
}
