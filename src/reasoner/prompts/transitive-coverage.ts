import type { DependencyEdge, ClassNode, FunctionNode, TestInventory } from '../../types/code-model';

export interface TransitiveCoveragePromptInput {
  edges: DependencyEdge[];
  classes: ClassNode[];
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>;
  testInventory: TestInventory;
}

function serializeInput(input: TransitiveCoveragePromptInput): string {
  return JSON.stringify(
    {
      dependencyGraph: input.edges,
      classes: input.classes.map((cls) => ({
        name: cls.name,
        type: cls.type,
        methods: cls.methods.map((m) => ({
          name: m.name,
          visibility: m.visibility,
          externalCalls: m.externalCalls,
          internalCalls: m.internalCalls,
        })),
        dependencies: cls.dependencies,
      })),
      standaloneFunctions: (input.standaloneFunctions ?? []).map((entry) => ({
        filePath: entry.filePath,
        functions: entry.functions.map((fn) => ({
          name: fn.name,
          visibility: fn.visibility,
          externalCalls: fn.externalCalls,
          internalCalls: fn.internalCalls,
        })),
      })),
      coverage: input.testInventory.coverage,
      testFiles: input.testInventory.testFiles.map((tf) => ({
        filePath: tf.filePath,
        describes: tf.describes.map((d) => ({
          name: d.name,
          tests: d.tests.map((t) => ({
            name: t.name,
            targetMethod: t.targetMethod,
            mocks: t.mocks,
          })),
        })),
      })),
    },
    null,
    2
  );
}

export function buildTransitiveCoveragePrompt(input: TransitiveCoveragePromptInput): {
  system: string;
  user: string;
} {
  const system = `You analyze the dependency graph and test coverage to determine transitive coverage for class methods and standalone exported functions.

## Task

For each dependency chain, determine if testing one layer transitively covers the layers it calls.

## Input Data

- \`dependencyGraph\`: edges between classes (injection = constructor dependency, method_call = runtime call)
- \`classes\`: each method's \`externalCalls\` (cross-class calls) and \`internalCalls\` (this.method() calls within the same class)
- \`testFiles\`: each test's \`targetMethod\` and \`mocks\` (which dependencies the test mocks/stubs)

## How to Determine Transitive Coverage

**Step 1 — Identify dependency chains from the graph:**
For each class A that depends on class B (via method_call edge), look at which methods of A call methods of B (via externalCalls).

**Step 2 — Check if tests mock the dependency:**
Look at the mocks list for tests targeting the calling method. If a test mocks class B, then B's actual code is NOT exercised → \`coveredTransitively: false\`.

**Step 3 — Assess the calling method's role:**
- Pure delegation (pass-through, no data transformation) → transitive coverage IS sufficient if not mocked
- Data transformation, enrichment, or error wrapping → transitive coverage is NOT sufficient even if not mocked
- Independent side effects (logging, metrics) → transitive for the main logic, but side effects need their own test

## Intra-Class Chains

Use \`internalCalls\` to identify chains within the same class (e.g., \`getOrder\` → \`request\` → \`authenticate\`). These are often tested transitively because the test calls the public method which internally exercises private helpers. Mark \`coveredTransitively: true\` unless the private method has complex branching that the public method's tests don't cover.

## Mock Detection Rules

- If \`mocks\` contains a class name or module path → that dependency is mocked
- If \`mocks\` contains "axios", "http", "fetch" → HTTP layer is mocked, but internal class chain above it may still be exercised
- Empty \`mocks\` → test exercises real code paths (good for transitive coverage)

Return ONLY valid JSON. No markdown, no explanation outside the JSON. Output a JSON array of objects with this exact schema:
[
  {
    "from": "string - ClassName.methodName that has the test",
    "through": "string - ClassName.methodName that is called",
    "to": "string - ClassName.methodName or external target at the end of the chain",
    "coveredTransitively": boolean,
    "caveat": "string | null - any caveat or condition",
    "confidence": number between 0 and 1
  }
]

Include a confidence score (0-1) for each inference. Higher confidence when mock data clearly confirms or denies transitive coverage.`;

  const user = serializeInput(input);

  return { system, user };
}
