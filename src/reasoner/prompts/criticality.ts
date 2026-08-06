import type { ClassNode, DependencyEdge, FunctionNode } from '../../types/code-model';

export interface MethodCoverageInfo {
  lineCoveragePercent: number;
  branchCoveragePercent: number;
}

export interface CriticalityPromptInput {
  classes: ClassNode[];
  dependencyGraph?: DependencyEdge[];
  istanbulCoverage?: Map<string, MethodCoverageInfo>;
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>;
}

function buildDependedOnByMap(classes: ClassNode[], edges: DependencyEdge[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const cls of classes) {
    result.set(cls.name, []);
  }
  for (const edge of edges) {
    if (edge.type === 'method_call' || edge.type === 'injection') {
      const list = result.get(edge.to);
      if (list && !list.includes(edge.from)) {
        list.push(edge.from);
      }
    }
  }
  return result;
}

function serializeClasses(
  classes: ClassNode[],
  dependencyGraph?: DependencyEdge[],
  istanbulCoverage?: Map<string, MethodCoverageInfo>,
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>,
): string {
  const dependedOnBy = dependencyGraph
    ? buildDependedOnByMap(classes, dependencyGraph)
    : new Map<string, string[]>();

  return JSON.stringify(
    {
      classes: classes.map((cls) => ({
        name: cls.name,
        type: cls.type,
        methods: cls.methods.map((m) => {
          const cov = istanbulCoverage?.get(`${cls.name}.${m.name}`);
          return {
            name: m.name,
            visibility: m.visibility,
            returnType: m.returnType,
            branchCount: m.branchCount,
            throwsErrors: m.throwsErrors,
            hasAsyncOps: m.hasAsyncOps,
            externalCalls: m.externalCalls,
            internalCalls: m.internalCalls,
            ...(cov ? {
              lineCoveragePercent: Math.round(cov.lineCoveragePercent),
              branchCoveragePercent: Math.round(cov.branchCoveragePercent),
            } : {}),
          };
        }),
        dependencies: cls.dependencies,
        ...(dependedOnBy.get(cls.name)?.length
          ? { dependedOnBy: dependedOnBy.get(cls.name) }
          : {}),
      })),
      standaloneFunctions: (standaloneFunctions ?? []).map((entry) => ({
        filePath: entry.filePath,
        functions: entry.functions.map((fn) => {
          const cov = istanbulCoverage?.get(`${entry.filePath}.${fn.name}`);
          return {
            name: fn.name,
            visibility: fn.visibility,
            returnType: fn.returnType,
            branchCount: fn.branchCount,
            throwsErrors: fn.throwsErrors,
            hasAsyncOps: fn.hasAsyncOps,
            externalCalls: fn.externalCalls,
            internalCalls: fn.internalCalls,
            ...(cov ? {
              lineCoveragePercent: Math.round(cov.lineCoveragePercent),
              branchCoveragePercent: Math.round(cov.branchCoveragePercent),
            } : {}),
          };
        }),
      })),
    },
    null,
    2
  );
}

export function buildCriticalityPrompt(input: CriticalityPromptInput): {
  system: string;
  user: string;
} {
  const system = `You rate the business criticality of each class method and standalone exported function.

## Criticality Levels

- **high**: data mutation, external HTTP calls, payment/auth logic, side effects that affect system state, orchestration of critical workflows
- **medium**: data reads, aggregation, transformation of important data, caching logic, validation
- **low**: simple getters, version strings, formatting, pure utilities with no side effects, in-memory lookups

## Blast Radius

Each class may include a \`dependedOnBy\` field listing other classes that depend on it. Use this to assess blast radius:
- A method in a class that 3+ other classes depend on is more critical — a bug cascades
- A method in a class with no dependents affects only itself — lower blast radius
- Private helper methods called by high-critical public methods inherit elevated criticality

## Signals for Each Level

**High criticality signals:**
- \`hasAsyncOps: true\` + \`externalCalls\` pointing to HTTP clients, databases, message queues
- \`throwsErrors: true\` + high \`branchCount\` — complex error handling with production impact
- Method name suggests mutation: \`send\`, \`create\`, \`update\`, \`delete\`, \`convert\`, \`backfill\`
- Class \`dependedOnBy\` has 2+ entries (high blast radius)

**Medium criticality signals:**
- \`hasAsyncOps: true\` but external calls are reads (fetchers, loaders)
- \`branchCount > 0\` with data transformation logic
- Caching methods (risk of stale data)

**Low criticality signals:**
- \`branchCount: 0\`, no external calls, no async ops
- Pure lookup/filter methods (\`find\`, \`get\`, \`filter\`)
- \`visibility: public\` but no dependents and simple logic

## Istanbul Coverage Data

When available, each method includes \`lineCoveragePercent\` and \`branchCoveragePercent\` from Istanbul. Use this to sharpen your assessment:
- A **high-critical** method with **0% coverage** is the most urgent gap — emphasize this in your reasoning
- A **high-critical** method with **90%+ coverage** is still high-critical, but the gap is less urgent
- Low coverage on a low-critical method is less concerning
- If coverage data is absent, judge criticality purely from code signals

Return ONLY valid JSON. No markdown, no explanation outside the JSON. Output a JSON array of objects with this exact schema:
[
  {
    "className": "string",
    "methodName": "string",
    "criticality": "low" | "medium" | "high",
    "reasoning": "string - brief explanation including blast radius if relevant",
    "confidence": number between 0 and 1
  }
]

For standalone exported functions, set "className" to the function's filePath from the input.

You MUST rate every method. Include a confidence score (0-1) for each rating.`;

  const user = serializeClasses(
    input.classes,
    input.dependencyGraph,
    input.istanbulCoverage,
    input.standaloneFunctions,
  );

  return { system, user };
}
