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
