# Product Backlog

> Last updated: 2026-08-18
> Repo: deep-cover

## Ready

| ID | Title | Notes | Spec | Plan | Added |
|----|-------|-------|------|------|-------|
| BL-001 | One StateCatalog for aggregate and per-method scores | Planned — spec + 7-task implementation plan ready; scope covers all 4 state consumers (aggregate, per-method, untested list, gaps). High priority, impact 4/effort 2. | [spec](../superpowers/specs/2026-08-18-state-catalog-design.md) | [plan](../superpowers/plans/2026-08-18-state-catalog.md) | 2026-08-18 |
| BL-002 | Validate config and runtime JSON with existing Zod | `DeepCoverConfigSchema` + optional Jest/Istanbul runtime schemas via `safeParse` with clear warnings — use Zod already in the package, not a new config loader. High priority, impact 4/effort 2. | | | 2026-08-18 |
| BL-003 | Callable + CoverageKey instead of class/function dual loops | Collapse MethodNode/FunctionNode parallel universes into `CallableNode` + a single `CoverageKey` used by extractor, resolver, scorer, reasoner, and bug-detector. High priority, impact 4/effort 4. | | | 2026-08-18 |

## Ideas

| ID | Title | Notes | Added |
|----|-------|-------|-------|
| BL-004 | OpenAI and Gemini Reasoner providers | Add OpenAI and Gemini `LLMProvider` implementations and wire them in `resolveLLMProvider`. | 2026-08-18 |
| BL-005 | Reconciliation prompt | Add a 5th Reasoner prompt that cross-references all 4 job outputs and adjusts contradictions. | 2026-08-18 |
| BL-006 | Constructor logic as pseudo-method | Extract constructor body logic (branches, calls) as a pseudo-method so tests for constructor behavior get attributed. | 2026-08-18 |
| BL-007 | Few-shot examples in prompts | Add 2-3 concrete good-vs-bad examples to each Reasoner system prompt to improve output quality. | 2026-08-18 |
| BL-008 | HTML report | Add a rich HTML report output with expandable per-function breakdowns and dependency graph visualization. | 2026-08-18 |
| BL-009 | Vitest support | Add a working Vitest analysis path so DeepCover is not Jest-only for TypeScript projects. | 2026-08-18 |
| BL-010 | Wire or delete dead config | Either implement `reasoner.maxInfluence` / `thresholds.composite` and use `getTransitivePaths` in scoring, or remove them so the API does not lie. | 2026-08-18 |
| BL-011 | Surface reasoner job failures instead of empty arrays | Replace silent `runJob` → `[]` + bracket scrapers with structured job results (and tests); prefer provider JSON mode when available. | 2026-08-18 |
| BL-012 | Split test-analyzer.ts by concern | Break the ~1050-line Jest inventory god module into focused modules with a thin `analyzeTestFile` orchestrator. | 2026-08-18 |
| BL-013 | Integration tests must not swallow extract failures | Stop `catch { return }` in integration specs so missing/broken fixtures fail the suite instead of passing. | 2026-08-18 |
| BL-014 | Run should score when reasoner-output is already filled | In agent-template mode `run` stops after the reason stage even when a filled `reasoner-output.json` is sitting on disk, so the user gets no score from the flagship command. | 2026-08-18 |
| BL-015 | Dedupe extractMethodFromTarget | One helper next to `matchers.ts` now; eventually persist `calledMethod` from ts-morph at extract time instead of re-regexing `AssertionNode.target`. | 2026-08-18 |

## In Progress

| ID | Title | Handoff | Branch |
|----|-------|---------|--------|
| | | | |

## Done

| ID | Title | Completed |
|----|-------|-----------|
| | | |

## Dropped

| ID | Title | Reason | Dropped |
|----|-------|--------|---------|

## Decision Log

### 2026-08-18 — BL-001 (planned)
- Wrote the 7-task implementation plan (`docs/superpowers/plans/2026-08-18-state-catalog.md`); status → planned.
- During planning discovered the gap generator already emits static-state gaps with a third testedness semantic (any affected method covered, medium-risk floor); spec corrected — the catalog replaces both of its state loops.

### 2026-08-18 — BL-001
- Brainstormed and approved the design spec (`docs/superpowers/specs/2026-08-18-state-catalog-design.md`); status → designing.
- Scope widened beyond the original two consumers: the untested list and gap-generator are also reasoner-only today and will read the same catalog.
- Granularity: one entry per state×method pair; static states get confidence 1.0; testedness computed once at catalog build (coverage floor now applies to the aggregate too).

### 2026-08-18 — Bulk import from anatoly-procedures
- Migrated 15 open DeepCover tasks from `anatoly-procedures` (testing/ai-workflow/code-quality categories) into this repo's product backlog — these are product features of DeepCover itself, not process improvements, so they belong here instead.
- Priority `high` tasks (original impact 4, effort ≤4) placed in `Ready`: BL-001 (orig. task 029), BL-002 (orig. task 033), BL-003 (orig. task 026).
- Priority `medium`/`low` tasks placed in `Ideas`: BL-004 (019), BL-005 (006), BL-006 (008), BL-007 (010), BL-008 (013), BL-009 (020), BL-010 (031), BL-011 (030), BL-012 (027), BL-013 (034), BL-014 (035), BL-015 (032).
- 12 `done` DeepCover tasks were left in `anatoly-procedures` as historical record and were not migrated.
- Original anatoly-procedures task files for the 15 migrated items were deleted after migration.
