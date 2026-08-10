import type { ClassNode, TestFileNode } from '../../types/code-model';
import type { BugSignal } from '../../bug-detector/types';

export interface BugFindingPromptInput {
  classes: ClassNode[];
  testFiles: TestFileNode[];
  bugSignals: BugSignal[];
}

function serializeInput(input: BugFindingPromptInput): string {
  return JSON.stringify(
    {
      classes: input.classes.map((cls) => ({
        name: cls.name,
        type: cls.type,
        methods: cls.methods.map((m) => ({
          name: m.name,
          returnType: m.returnType,
          params: m.params,
          branches: m.branches.map((b) => ({
            type: b.type,
            condition: b.condition,
            // Split operands let the model judge an `untested-condition-operand` signal
            // against the actual structure of the condition.
            ...(b.operands
              ? { operator: b.operator, operands: b.operands.map((o) => o.text) }
              : {}),
          })),
          externalCalls: m.externalCalls,
          throwsErrors: m.throwsErrors,
        })),
        dependencies: cls.dependencies,
      })),
      testFiles: input.testFiles.map((tf) => ({
        filePath: tf.filePath,
        describes: tf.describes.map((d) => ({
          name: d.name,
          tests: d.tests.map((t) => ({
            name: t.name,
            targetMethod: t.targetMethod,
            assertions: t.assertions,
            mocks: t.mocks,
            ...(t.targetCallArgs ? { targetCallArgs: t.targetCallArgs } : {}),
          })),
        })),
      })),
      bugSignals: input.bugSignals.map((s, i) => ({
        index: i,
        pattern: s.pattern,
        className: s.className,
        methodName: s.methodName,
        evidence: s.evidence,
        confidence: s.confidence,
      })),
    },
    null,
    2
  );
}

export function buildBugFindingPrompt(input: BugFindingPromptInput): {
  system: string;
  user: string;
} {
  const system = `You analyze TypeScript code and its tests to find potential bugs that tests should catch but don't.

You are NOT looking for coverage gaps (untested methods). You are looking for situations where:
1. Code exists and has tests, but tests don't verify critical behavior
2. Tests create a false sense of security by checking the wrong things

## Focus Patterns

### untested-invariant
Business rules or invariants in code that no test verifies.
Example: \`calculateDiscount()\` checks \`amount > 0\`, but all tests pass only positive amounts.

### mock-hiding-behavior
Tests mock a dependency and only verify the mock was called, but don't verify how the method handles the dependency's response.
Example: Test mocks \`repo.findById()\` and checks \`toHaveBeenCalledWith(id)\`, but doesn't test what happens when repo returns \`null\`.

### unchecked-side-effect
Method mutates state (object properties, database, external system), but tests only check the return value.
Example: \`updateUser()\` sets \`user.updatedAt\` and returns status. Test checks status but not \`updatedAt\`.

## Bug Signal Validation

The input includes \`bugSignals\` — findings from deterministic static analysis. For each signal:
- Evaluate whether it represents a real risk
- Return \`confirmed: true\` if the signal points to a genuine potential bug
- Return \`confirmed: false\` with reasoning if it's a false positive

For \`untested-condition-operand\` signals specifically: the claim is that one operand of a \`||\`/\`&&\` condition is never the operand that decides the branch, so deleting it would keep the suite green. Check it against the branch's \`operands\` array and the tests' \`targetCallArgs\` — confirm when no test drives that operand, reject when some test clearly does (or when the operand cannot be driven independently, e.g. it is implied by another operand).

## Guidelines

- Focus on HIGH and MEDIUM risk findings. Skip trivial scenarios.
- Each finding must include a concrete \`suggestedTest\` — a test sketch, not abstract advice.
- Don't flag simple getters/setters or pure delegation with no logic.
- Don't duplicate what static state discovery (Job 1) already covers.

## Output Format

Return ONLY valid JSON with this exact schema:
{
  "findings": [
    {
      "pattern": "untested-invariant" | "mock-hiding-behavior" | "unchecked-side-effect",
      "className": "string",
      "methodName": "string",
      "description": "string",
      "risk": "high" | "medium" | "low",
      "suggestedTest": "string"
    }
  ],
  "signalValidations": [
    {
      "signalIndex": number,
      "confirmed": boolean,
      "reasoning": "string"
    }
  ]
}`;

  const user = serializeInput(input);

  return { system, user };
}
