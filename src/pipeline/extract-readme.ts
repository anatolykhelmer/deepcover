export function generateReadme({ classCount, methodCount }: { classCount: number; methodCount: number }): string {
  return `# DeepCover — Agent Instructions

This directory contains everything you need to perform an LLM-powered code coverage analysis.
No external tools or API keys required — you are the Reasoner.

## What's here

| File | Description |
|------|-------------|
| \`code-model.json\` | Structured code model: ${classCount} classes, ${methodCount} methods, with branches, test inventory, dependency graph |
| \`prompts.json\` | 4 pre-built prompts (one per Reasoner job) — read these as your instructions |
| \`reasoner-output.json\` | **Your deliverable** — empty template, fill it with your analysis |
| \`jest-runtime.json\` | *(if present)* Per-test pass/fail status, duration, assertion counts from Jest |
| \`istanbul-coverage.json\` | *(if present)* Istanbul line/branch/function coverage data |

## Your task

Read \`code-model.json\` to understand the codebase structure, then perform 4 analysis jobs.
For each job, read the corresponding prompt from \`prompts.json\` and produce structured output.

### Job 1 — Domain State Discovery (\`discoveredStates\`)

For each method, identify meaningful domain states that static analysis missed:
- Business scenarios, error conditions, external system states, data edge cases

\`\`\`json
{ "className": "...", "methodName": "...", "state": "...", "isTested": false, "riskIfUntested": "high", "confidence": 0.9 }
\`\`\`

### Job 2 — Assertion Quality Judgment (\`assertionJudgments\`)

For each test, judge assertion quality as **weak** / **medium** / **strong**:
- weak: only existence checks (toBeDefined, toBeTruthy)
- medium: checks values but not side effects
- strong: checks values AND verifies correct interactions

\`\`\`json
{ "testName": "...", "quality": "weak", "reasoning": "...", "confidence": 0.95 }
\`\`\`

### Job 3 — Criticality Assessment (\`criticalityRatings\`)

Rate each method's business criticality as **low** / **medium** / **high**:
- high: data mutations, external calls, payment/auth logic
- medium: data reads, aggregations, queries
- low: simple getters, formatting, constants

\`\`\`json
{ "className": "...", "methodName": "...", "criticality": "high", "reasoning": "...", "confidence": 0.95 }
\`\`\`

### Job 4 — Transitive Coverage (\`transitiveInferences\`)

For each dependency chain, determine if testing lower layers covers higher ones:
- Pure delegation → transitive coverage sufficient
- Data transformation in the middle → needs explicit test

\`\`\`json
{ "from": "A.method", "through": "B.method", "to": "C.method", "coveredTransitively": false, "caveat": "...", "confidence": 0.8 }
\`\`\`

## Writing your output

Combine all 4 jobs into \`reasoner-output.json\`:

\`\`\`json
{
  "discoveredStates": [...],
  "assertionJudgments": [...],
  "criticalityRatings": [...],
  "transitiveInferences": [...]
}
\`\`\`

Every item **must** have a \`confidence\` score (0–1). Be honest — the scorer caps LLM influence at ±20%.
Focus on the **most critical** gaps. 5 high-quality insights beat 50 generic ones.

## Running the final analysis

After writing \`reasoner-output.json\`, run:

\`\`\`bash
npx deepcover analyze --root <PROJECT_ROOT>
\`\`\`

Add \`--format json\` for machine-readable output, or \`--format score\` for a bare number.

This produces a scored report: composite score (0–100), sub-scores, per-method breakdown, and prioritized gaps.
`;
}
