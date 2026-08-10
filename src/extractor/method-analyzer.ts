import {
  ClassDeclaration,
  MethodDeclaration,
  Node,
  SyntaxKind,
  PropertyAccessExpression,
  CallExpression,
} from 'ts-morph';
import type { MethodNode, ParamNode } from '../types/code-model';
import { collectBranches } from './branch-analyzer';

export function analyzeMethods(cls: ClassDeclaration, paramToType: Map<string, string>): MethodNode[] {
  const methods = cls.getInstanceMethods();
  return methods.map((m) => analyzeMethod(m, paramToType));
}

function analyzeMethod(method: MethodDeclaration, paramToType: Map<string, string>): MethodNode {
  const name = method.getName();
  const visibility = getVisibility(method);
  const params: ParamNode[] = method.getParameters().map((p) => ({
    name: p.getName(),
    type: p.getTypeNode()?.getText() ?? 'unknown',
    isOptional: p.isOptional(),
  }));
  const returnType = method.getReturnTypeNode()?.getText() ?? 'void';

  const body = method.getBody();
  const branches = body ? collectBranches(body, params.map((p) => p.name)) : [];
  const branchCount = branches.length;
  const hasAsyncOps = method.isAsync() || (body ? hasAwait(body) : false);
  const throwsErrors = body ? hasThrow(body) : false;
  const externalCalls = body ? collectExternalCalls(body, paramToType) : [];
  const internalCalls = body ? collectInternalCalls(body) : [];

  return {
    name,
    visibility,
    params,
    returnType,
    branches,
    branchCount,
    throwsErrors,
    hasAsyncOps,
    externalCalls,
    internalCalls,
    startLine: method.getStartLineNumber(),
    endLine: method.getEndLineNumber(),
  };
}

function getVisibility(method: MethodDeclaration): MethodNode['visibility'] {
  if (method.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
  if (method.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
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

  function visit(node: Node) {
    if (Node.isCallExpression(node)) {
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const pa = expr as PropertyAccessExpression;
        const chain = getThisPropertyChain(pa);
        if (chain) {
          const [propName, methodName] = chain;
          const typeName = paramToType.get(propName);
          if (typeName && methodName) {
            const key = `${typeName}.${methodName}`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push(key);
            }
          }
        }
      }
    }
    node.forEachChild((c) => visit(c));
  }

  visit(body);
  return calls;
}

/** Detect this.<method>() calls — intra-class method invocations. */
function collectInternalCalls(body: Node): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();

  function visit(node: Node) {
    if (Node.isCallExpression(node)) {
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const pa = expr as PropertyAccessExpression;
        const innerExpr = pa.getExpression();
        if (Node.isThisExpression(innerExpr)) {
          const methodName = pa.getName();
          if (!seen.has(methodName)) {
            seen.add(methodName);
            calls.push(methodName);
          }
        }
      }
    }
    node.forEachChild((c) => visit(c));
  }

  visit(body);
  return calls;
}

function getThisPropertyChain(pa: PropertyAccessExpression): [string, string] | null {
  const name = pa.getName();
  const expr = pa.getExpression();

  if (Node.isPropertyAccessExpression(expr)) {
    const inner = expr as PropertyAccessExpression;
    const innerExpr = inner.getExpression();
    if (Node.isThisExpression(innerExpr)) {
      return [inner.getName(), name];
    }
  }

  return null;
}
