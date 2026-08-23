import {
  ClassDeclaration,
  MethodDeclaration,
  Node,
  SyntaxKind,
  PropertyAccessExpression,
  CallExpression,
} from 'ts-morph';
import type { MethodNode } from '../types/code-model';
import { assembleCallableNode, buildParamNodes } from './callable-common';

export function analyzeMethods(cls: ClassDeclaration, paramToType: Map<string, string>): MethodNode[] {
  const methods = cls.getInstanceMethods();
  return methods.map((m) => analyzeMethod(m, paramToType));
}

function analyzeMethod(method: MethodDeclaration, paramToType: Map<string, string>): MethodNode {
  const body = method.getBody();
  return assembleCallableNode({
    name: method.getName(),
    visibility: getVisibility(method),
    node: method,
    params: buildParamNodes(method),
    externalCalls: body ? collectExternalCalls(body, paramToType) : [],
    internalCalls: body ? collectInternalCalls(body) : [],
  });
}

function getVisibility(method: MethodDeclaration): MethodNode['visibility'] {
  if (method.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
  if (method.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
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
