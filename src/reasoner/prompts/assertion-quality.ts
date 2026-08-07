import type { TestFileNode, ClassNode, MethodNode, FunctionNode } from '../../types/code-model';

export interface AssertionQualityPromptInput {
  testFiles: TestFileNode[];
  classes?: ClassNode[];
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>;
}

function buildMethodIndex(
  classes: ClassNode[],
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>,
): Map<string, MethodNode | FunctionNode> {
  const index = new Map<string, MethodNode | FunctionNode>();
  for (const cls of classes) {
    for (const m of cls.methods) {
      index.set(m.name, m);
    }
  }
  for (const moduleFunctions of standaloneFunctions ?? []) {
    for (const fn of moduleFunctions.functions) {
      index.set(fn.name, fn);
    }
  }
  return index;
}

function serializeTestFiles(
  testFiles: TestFileNode[],
  classes?: ClassNode[],
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>,
): string {
  const methodIndex = classes ? buildMethodIndex(classes, standaloneFunctions) : new Map<string, MethodNode | FunctionNode>();

  return JSON.stringify(
    {
      testFiles: testFiles.map((tf) => ({
        filePath: tf.filePath,
        describes: tf.describes.map((d) => ({
          name: d.name,
          tests: d.tests.map((t) => {
            const method = t.targetMethod ? methodIndex.get(t.targetMethod) : undefined;
            return {
              name: t.name,
              targetMethod: t.targetMethod,
              assertions: t.assertions.map((a) => ({
                type: a.type,
                target: a.target,
                matcherUsed: a.matcherUsed,
              })),
              mocks: t.mocks,
              isAsync: t.isAsync,
              ...(t.parameterized ? { parameterized: t.parameterized } : {}),
              ...(method ? {
                targetMethodInfo: {
                  visibility: method.visibility,
                  branchCount: method.branchCount,
                  branches: method.branches.map((b) => ({ type: b.type, condition: b.condition })),
                  throwsErrors: method.throwsErrors,
                  hasAsyncOps: method.hasAsyncOps,
                  externalCalls: method.externalCalls,
                },
              } : {}),
            };
          }),
        })),
      })),
      standaloneFunctions: (standaloneFunctions ?? []).map((entry) => ({
        filePath: entry.filePath,
        functions: entry.functions.map((fn) => ({
          name: fn.name,
          branchCount: fn.branchCount,
          throwsErrors: fn.throwsErrors,
          hasAsyncOps: fn.hasAsyncOps,
          externalCalls: fn.externalCalls,
        })),
      })),
    },
    null,
    2
  );
}

export function buildAssertionQualityPrompt(input: AssertionQualityPromptInput): {
  system: string;
  user: string;
} {
  const system = `You judge the assertion quality of Jest/Vitest tests.

Each test includes its assertions, mocks, and — when available — information about the target method it tests (branch conditions, external calls, error handling). Use the target method info to judge whether assertions are sufficient for the method's complexity.

## Quality Levels

- **weak**: only existence checks (toBeDefined, toBeTruthy, toBeFalsy) — does not verify values or behavior. Also weak if the method has many branches but the test checks only one outcome.
- **medium**: checks values (toEqual, toBe) but misses important aspects. Examples:
  - Checks return value but not side effects (external calls, logging) for a method with side effects
  - Checks happy path but the method has error branches (try/catch, status checks) that aren't tested
  - Has mocks but doesn't verify they were called correctly
- **strong**: checks values AND verifies correct interactions for the method's complexity. Examples:
  - For a method with external calls: toEqual on result + toHaveBeenCalledWith on the dependency
  - For a method with error branches: toThrow + verifies retry/fallback behavior
  - For a pure function: toEqual is sufficient (no side effects to check)

## Key Principle

Quality is relative to the method's complexity:
- A test with only \`toEqual\` is **strong** for a pure getter but **medium** for a method with 5 branches and external calls
- A test with \`toHaveBeenCalledTimes\` alone is **medium** — it verifies the call happened but not with correct arguments

## Assessing Mock Coverage

If a test mocks dependencies, check:
- Are mocked return values realistic? (not just \`undefined\`)
- Does the test verify mock interactions? (\`toHaveBeenCalledWith\` > \`toHaveBeenCalled\` > no verification)
- Are error scenarios of mocked dependencies tested? (mock rejects/throws)

Return ONLY valid JSON. No markdown, no explanation outside the JSON. Output a JSON array of objects with this exact schema:
[
  {
    "testName": "string",
    "quality": "weak" | "medium" | "strong",
    "reasoning": "string - brief explanation referencing the method's complexity",
    "confidence": number between 0 and 1
  }
]

Include a confidence score (0-1) for each judgment. Higher confidence when targetMethodInfo is available.`;

  const user = serializeTestFiles(input.testFiles, input.classes, input.standaloneFunctions);

  return { system, user };
}
