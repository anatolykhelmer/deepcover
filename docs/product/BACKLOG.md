# Product Backlog

> Last updated: 2026-08-20
> Repo: deep-cover

## Ready

| ID | Title | Notes | Spec | Plan | Added |
|----|-------|-------|------|------|-------|
| BL-002 | Validate config and runtime JSON with existing Zod | **planned** — `DeepCoverConfigSchema` + `safeParse` with clear warnings, using the Zod already in the package. Runtime-artifact schemas cut from scope. Ships as 0.6.0. High priority, impact 4/effort 2. | [spec](../superpowers/specs/2026-08-20-config-validation-design.md) | [plan](../superpowers/plans/2026-08-20-config-validation.md) | 2026-08-18 |
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
| BL-017 | Rename className to owner in getBranchScaleForState | `state-coverage.ts`'s `getBranchScaleForState` still names its parameter `className`, but since BL-001 it can receive a module filePath for standalone-function-owned catalog entries (correct behavior, misleading name). Also collapse the `affectedMethods: string[]` parameter to a single `methodName` — every call site now passes a one-element array. | 2026-08-19 |

## In Progress

| ID | Title | Handoff | Branch |
|----|-------|---------|--------|
| | | | |

## Done

| ID | Title | Completed |
|----|-------|-----------|
| BL-001 | One StateCatalog for aggregate and per-method scores | 2026-08-18 |

## Dropped

| ID | Title | Reason | Dropped |
|----|-------|--------|---------|
| BL-016 | Exact-key dedupe in gap-generator | Superseded: PR #3 review removed the substring guard entirely — after catalog dedupe the check was redundant and harmful. | 2026-08-19 |

## Decision Log

### 2026-08-20 — BL-002 (amended: fail-hard)
- Reversed the original "warn + fall back to defaults" decision: an invalid config now throws `ConfigError` and stops the run with exit code 1. The fallback silently changed `reasoner.provider`, so a typo in one field could run the analysis against a different provider than configured — and in CI, where `--min-score` gates a build, silently-wrong numbers are worse than a stopped run. Strict schema + soft fallback was also the incoherent pairing.
- All three failure kinds fail hard (unreadable / unparseable / schema-invalid). A *missing* config file still runs on defaults silently.
- Uncovered and fixed while doing it: `extract` had no `try/catch` at all and read config at the very *end* (only for the "Next:" hint), so failing there would abort after artifacts were written and success printed; `reason` read config just outside its `try`, so a throw would escape as an unhandled rejection with a stack trace. Config now loads before any work in every command.
- Spec amended in place with a dated note rather than rewritten, so the reversal and its reasoning stay visible.

### 2026-08-20 — BL-002 (planned)
- Wrote the 4-task implementation plan (`docs/superpowers/plans/2026-08-20-config-validation.md`); status → planned.
- Version bump folded in as Task 4: `package.json` was still on 0.5.0 while the README already documented 0.6.0 as unreleased (left over from BL-001). 0.6.0 now covers both changes.
- During planning, verified against the working tree that the `z.infer` type is a drop-in for the interface (`tsc --noEmit` clean, including `resolve-provider.ts`'s indexed access) and that `loadConfig` can be tested in-process under ts-jest for `.ts` configs — so config tests do not need to shell out to the CLI the way the other CLI specs do.

### 2026-08-20 — BL-002
- Brainstormed and approved the design spec (`docs/superpowers/specs/2026-08-20-config-validation-design.md`); status → designing.
- Scope narrowed: config only. Runtime-artifact validation (`jest-runtime.json`, Istanbul `coverage-final.json`) dropped — Istanbul's format is externally defined and `loadIstanbulCoverage` already degrades safely.
- Schema is the source of truth (`z.infer` replaces the hand-written interface), strict objects at every level so typo'd keys are errors rather than silent no-ops.
- Scope widened to two adjacent bugs in the same loader: the shallow spread that wiped sibling defaults in a partially specified section, and the silent `catch {}` that discarded a whole `.ts`/`.js` config without a message.
- No sum-to-1 constraint on `weights` — they are unread by any scorer today; wiring or deleting them stays BL-010.

### 2026-08-19 — PR #3 review applied; BL-016 dropped
- Applied the PR #3 review suggestions on the BL-001 branch: removed the gap-generator substring dedupe guard entirely (catalog identity makes it redundant; it swallowed distinct states), dropped ghost reasoner states (unknown method/class) at catalog build so the aggregate/per-method invariant holds for malformed LLM output, three-way gap `reason` by provenance, comment/README cleanups, plus pinning tests.
- BL-016 → Dropped: the review's stronger fix (delete the guard) supersedes the planned exact-key comparison.

### 2026-08-19 — BL-016, BL-017
- Added two follow-ups surfaced by BL-001's final whole-branch review, deferred there as non-blocking minors: BL-016 (gap-generator's substring dedupe should be exact-key) and BL-017 (`getBranchScaleForState`'s `className` param should be `owner`/single `methodName`). Both placed in `Ideas` — small, well-scoped, no urgency.

### 2026-08-18 — BL-001
- Implemented: `src/scorer/state-catalog.ts` is the single source of domain
  states; aggregate, per-method, untested lists, and gaps all read it.
  Behavior changes recorded in README ("State coverage in 0.6.0").

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
