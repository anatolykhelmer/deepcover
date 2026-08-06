import type { ClassNode, DependencyEdge } from '../types/code-model';

/**
 * Builds dependency edges from class nodes.
 * - Injection edges from ClassNode.dependencies
 * - Method call edges from MethodNode.externalCalls (format: 'ClassName.methodName')
 */
export function buildDependencyGraph(classNodes: ClassNode[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();

  function addEdge(from: string, to: string, type: DependencyEdge['type']) {
    const key = `${from}:${to}:${type}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from, to, type });
    }
  }

  for (const node of classNodes) {
    for (const dep of node.dependencies) {
      addEdge(node.name, dep, 'injection');
    }

    for (const method of node.methods) {
      for (const call of method.externalCalls) {
        const dotIdx = call.indexOf('.');
        if (dotIdx > 0) {
          const targetClass = call.slice(0, dotIdx);
          addEdge(node.name, targetClass, 'method_call');
        }
      }
    }
  }

  return edges;
}

/**
 * Finds all paths from one class to another through the graph.
 * Uses DFS with cycle detection to avoid infinite loops.
 */
export function getTransitivePaths(
  edges: DependencyEdge[],
  from: string,
  to: string
): string[][] {
  const adj = buildAdjacencyList(edges);
  const paths: string[][] = [];

  function dfs(current: string, path: string[], visited: Set<string>) {
    if (current === to) {
      paths.push([...path]);
      return;
    }

    const neighbors = adj.get(current) ?? [];
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      dfs(next, path, visited);
      path.pop();
      visited.delete(next);
    }
  }

  const visited = new Set<string>([from]);
  dfs(from, [from], visited);
  return paths;
}

/**
 * Returns immediate dependencies of a class (direct edges out).
 */
export function getDirectDependencies(edges: DependencyEdge[], className: string): string[] {
  const deps = new Set<string>();
  for (const e of edges) {
    if (e.from === className) {
      deps.add(e.to);
    }
  }
  return Array.from(deps);
}

/**
 * Returns all reachable dependencies (transitive closure).
 */
export function getTransitiveDependencies(edges: DependencyEdge[], className: string): string[] {
  const adj = buildAdjacencyList(edges);
  const result = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string) {
    if (visited.has(node)) return;
    visited.add(node);
    const neighbors = adj.get(node) ?? [];
    for (const next of neighbors) {
      result.add(next);
      dfs(next);
    }
  }

  const direct = adj.get(className) ?? [];
  for (const next of direct) {
    result.add(next);
    dfs(next);
  }
  return Array.from(result);
}

function buildAdjacencyList(edges: DependencyEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    if (!list.includes(e.to)) {
      list.push(e.to);
    }
    adj.set(e.from, list);
  }
  return adj;
}
