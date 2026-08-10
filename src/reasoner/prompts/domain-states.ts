import type { BranchNode, ClassNode, FunctionNode } from '../../types/code-model';

/**
 * A `||`/`&&` condition is sent both as written and split into its operands, so the model
 * enumerates one state per operand instead of collapsing the whole condition into a single
 * "a or b" state that one test can satisfy.
 */
function serializeBranch(branch: BranchNode) {
  return {
    type: branch.type,
    condition: branch.condition,
    ...(branch.operands
      ? { operator: branch.operator, operands: branch.operands.map((o) => o.text) }
      : {}),
  };
}

export interface DomainStatesPromptInput {
  classes: ClassNode[];
  testsByMethod?: Record<string, string[]>;
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>;
}

function serializeClasses(
  classes: ClassNode[],
  testsByMethod?: Record<string, string[]>,
  standaloneFunctions?: Array<{ filePath: string; functions: FunctionNode[] }>,
): string {
  return JSON.stringify(
    {
      classes: classes.map((cls) => ({
        name: cls.name,
        type: cls.type,
        methods: cls.methods.map((m) => ({
          name: m.name,
          visibility: m.visibility,
          returnType: m.returnType,
          branches: m.branches.map(serializeBranch),
          throwsErrors: m.throwsErrors,
          hasAsyncOps: m.hasAsyncOps,
          externalCalls: m.externalCalls,
          ...(testsByMethod?.[m.name]?.length ? { tests: testsByMethod[m.name] } : {}),
        })),
        dependencies: cls.dependencies,
      })),
      standaloneFunctions: (standaloneFunctions ?? []).map((entry) => ({
        filePath: entry.filePath,
        functions: entry.functions.map((fn) => ({
          name: fn.name,
          returnType: fn.returnType,
          branches: fn.branches.map(serializeBranch),
          throwsErrors: fn.throwsErrors,
          hasAsyncOps: fn.hasAsyncOps,
          externalCalls: fn.externalCalls,
          ...(testsByMethod?.[fn.name]?.length ? { tests: testsByMethod[fn.name] } : {}),
        })),
      })),
    },
    null,
    2
  );
}

export function buildDomainStatesPrompt(input: DomainStatesPromptInput): {
  system: string;
  user: string;
} {
  const system = `You analyze TypeScript/JavaScript class methods and standalone exported functions to discover domain states that static analysis may miss.

For each method, identify domain states — business scenarios, error conditions, external system states, and data edge cases.

## Input Data

Each method includes its branch conditions (the exact if/switch/guard/try_catch expressions from the source code) and, when available, the names of tests that exercise it. Use both to identify states.

A branch whose condition is a \`||\` / \`&&\` chain also carries an \`operands\` array — the individual conditions, already split for you. Treat each entry as its own testable condition (see "Compound Conditions" below).

## State Categories Checklist

Systematically check each method against these categories:

- **Error handling:** network failures, timeout, invalid response shape, auth token expiry, rate limiting (429), server errors (5xx), non-retryable errors (4xx)
- **Data edge cases:** null/undefined input, empty array/object, malformed data, boundary values (0, negative, MAX_INT), type mismatch
- **External dependencies:** service unavailable, partial response, stale cache, connection refused, DNS failure
- **Concurrency:** race conditions, duplicate calls, retry exhaustion, concurrent auth refresh
- **Validation:** missing required fields, invalid format, out-of-range values, unexpected types
- **Pagination:** first page, last page, empty page, truncated results, next_page present
- **Auth/Security:** expired token, insufficient permissions, revoked access, token refresh during request
- **Business logic:** crossgrade vs upgrade, prorated amounts, discount handling, multi-subscription orders

## Code Pattern → State Mapping

These code patterns typically imply specific states:

- \`try/catch\` with specific error types → each error type is a separate state
- \`if (!x)\` / \`if (x == null)\` → "missing data" state
- \`x.length === 0\` / \`isEmpty\` → "empty collection" state
- \`attempt < MAX\` / \`retryCount\` → "retry exhaustion" state
- \`cache.get\` / \`cache.has\` → "cache hit" + "cache miss" states
- \`Promise.race\` / \`Promise.all\` → "partial failure" state
- \`switch(x)\` → each case is a potential state
- \`instanceof\` / type guards → each type branch is a state
- \`for/forEach\` + \`continue\`/\`if (!cond) skip\`/\`.filter()\` → **"all items filtered → empty aggregate"** state. When a loop or filter can conditionally skip items, ALL items may be skipped, producing an empty result. This is a high-value domain state — flag it even when there is no explicit \`length === 0\` check in the code
- \`a || b\` / \`a && b\` in a condition → **one state per operand**, never one state for the whole condition (see below)

## Compound Conditions (\`||\` / \`&&\`)

Short-circuit evaluation makes every operand of a compound condition an independently testable state. \`if (a === undefined || Number.isNaN(b))\` throws for two different reasons, and a test that triggers it through \`a\` leaves \`Number.isNaN(b)\` unexercised — the operand could be deleted and that test would still pass. Coverage tools cannot see this: they count how often each operand was *evaluated*, not how often it *decided* the branch, so such a condition reports as fully covered.

So, for every branch with an \`operands\` array:

- Emit one state per operand, each describing only that operand's scenario.
- Judge \`isTested\` per operand: a state is tested only when some test drives *that specific operand* to decide the branch. A single test can only make one operand of an \`||\` decisive.
- **Never** write a state whose description joins two operands with "or" / "and" (e.g. "a non-numeric value for a or b throws"). That collapses two independently-testable conditions into one boolean and hides the gap. Split it into "a is non-numeric → throws" and "b is non-numeric → throws".
- The same holds for the operands of an \`&&\`: each one is a separate way to fall out of the branch.

## Method Role Awareness

Consider the method's role when identifying states:

- **Constructors/init:** dependency injection failures, config validation
- **Data fetchers:** empty results, pagination, stale data, partial responses
- **Converters/mappers:** type mismatches, unmappable values, lossy conversions, **loop with conditional inclusion may produce empty output**
- **Validators:** each validation rule is a state
- **Event handlers:** duplicate events, out-of-order events, malformed payloads

## Determining isTested

- Use test names to match states: if a test name clearly describes a scenario (e.g. "retries on 429" covers the "HTTP 429 rate limited" state), mark isTested: true.
- If no test name covers a discovered state, mark isTested: false.
- One test covers one state. If a single test would have to satisfy two states at once, they are the same state or you split them wrong — with operands of a compound condition, keep them split and mark only the one that test actually drives as tested.

## Risk Assessment (riskIfUntested)

- **high:** data corruption, security bypass, money/billing errors, silent data loss, unhandled auth failure
- **medium:** degraded performance, incorrect UI state, missing logs, stale cache served, pagination truncation
- **low:** cosmetic issues, redundant operations, non-critical fallback paths

## Include Both Tested and Untested States

Report ALL meaningful domain states you discover, whether tested or not. The scoring formula uses the ratio of tested-to-total discovered states, so omitting tested states artificially deflates the score. A good discoveredStates set has a healthy mix of tested states (proving coverage) and untested states (revealing gaps).

## What NOT to Report

- Trivial happy path with no domain significance (e.g. "method returns data successfully")
- Implementation details (e.g. "variable is assigned", "loop iterates")
- States that are purely structural with no business meaning (e.g. "loop runs N times")

## Output Format

Return ONLY valid JSON. No markdown, no explanation outside the JSON. Output a JSON array of objects with this exact schema:
[
  {
    "className": "string",
    "methodName": "string",
    "state": "string - the discovered state description",
    "isTested": boolean,
    "riskIfUntested": "low" | "medium" | "high",
    "confidence": number between 0 and 1
  }
]

For standalone exported functions, set "className" to the function's filePath from the input.

Include a confidence score (0-1) for each discovery. Higher confidence when branch conditions and test names provide clear evidence.`;

  const user = serializeClasses(input.classes, input.testsByMethod, input.standaloneFunctions);

  return { system, user };
}
