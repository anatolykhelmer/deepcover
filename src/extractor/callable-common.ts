import { Node } from 'ts-morph';
import type { CallableNode, ParamNode } from '../types/code-model';
import { collectBranches } from './branch-analyzer';

/** The ts-morph surface both analyzers' nodes share. */
export interface AnalyzableCallable {
  getParameters(): Array<{ getName(): string; getTypeNode(): { getText(): string } | undefined; isOptional(): boolean }>;
  getReturnTypeNode(): { getText(): string } | undefined;
  getBody(): Node | undefined;
  isAsync(): boolean;
  getStartLineNumber(): number;
  getEndLineNumber(): number;
}

export function buildParamNodes(node: AnalyzableCallable): ParamNode[] {
  return node.getParameters().map((p) => ({
    name: p.getName(),
    type: p.getTypeNode()?.getText() ?? 'unknown',
    isOptional: p.isOptional(),
  }));
}

export function hasAwait(node: Node): boolean {
  let found = false;
  node.forEachChild((child) => {
    if (Node.isAwaitExpression(child)) found = true;
    else found = found || hasAwait(child);
  });
  return found;
}

export function hasThrow(node: Node): boolean {
  let found = false;
  node.forEachChild((child) => {
    if (Node.isThrowStatement(child)) found = true;
    else found = found || hasThrow(child);
  });
  return found;
}

/**
 * Assembles a CallableNode from a ts-morph node plus the kind-specific call
 * collections. Call collection stays in each analyzer: methods look for
 * `this.dep.m()` chains and `this.m()`, functions for `param.m()` and bare
 * same-module calls — semantically different traversals, not duplication.
 */
export function assembleCallableNode(input: {
  name: string;
  visibility: CallableNode['visibility'];
  node: AnalyzableCallable;
  params: ParamNode[];
  externalCalls: string[];
  internalCalls: string[];
}): CallableNode {
  const { name, visibility, node, params, externalCalls, internalCalls } = input;
  const body = node.getBody();
  const branches = body ? collectBranches(body, params.map((p) => p.name)) : [];
  return {
    name,
    visibility,
    params,
    returnType: node.getReturnTypeNode()?.getText() ?? 'void',
    branches,
    branchCount: branches.length,
    throwsErrors: body ? hasThrow(body) : false,
    hasAsyncOps: node.isAsync() || (body ? hasAwait(body) : false),
    externalCalls,
    internalCalls,
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
  };
}
