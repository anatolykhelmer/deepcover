# Product Backlog

> Last updated: 2026-08-26
> Repo: deep-cover

## Ready

| ID | Title | Notes | Spec | Plan | Added |
|----|-------|-------|------|------|-------|
| | | _No items._ | | | |

## Ideas

| ID | Title | Notes | Added |
|----|-------|-------|-------|
| BL-004 | OpenAI and Gemini Reasoner providers | Add OpenAI and Gemini `LLMProvider` implementations and wire them in `resolveLLMProvider`. | 2026-08-18 |
| BL-005 | Reconciliation prompt | Add a 5th Reasoner prompt that cross-references all 4 job outputs and adjusts contradictions. | 2026-08-18 |
| BL-006 | Constructor logic as pseudo-method | Extract constructor body logic (branches, calls) as a pseudo-method so tests for constructor behavior get attributed. | 2026-08-18 |
| BL-007 | Few-shot examples in prompts | Add 2-3 concrete good-vs-bad examples to each Reasoner system prompt to improve output quality. | 2026-08-18 |
| BL-008 | HTML report | Add a rich HTML report output with expandable per-function breakdowns and dependency graph visualization. | 2026-08-18 |
| BL-009 | Vitest support | Add a working Vitest analysis path so DeepCover is not Jest-only for TypeScript projects. | 2026-08-18 |
| BL-011 | Surface reasoner job failures instead of empty arrays | Replace silent `runJob` → `[]` + bracket scrapers with structured job results (and tests); prefer provider JSON mode when available. | 2026-08-18 |
| BL-012 | Split test-analyzer.ts by concern | Break the ~1050-line Jest inventory god module into focused modules with a thin `analyzeTestFile` orchestrator. | 2026-08-18 |
| BL-013 | Integration tests must not swallow extract failures | Stop `catch { return }` in integration specs so missing/broken fixtures fail the suite instead of passing. | 2026-08-18 |
| BL-014 | Run should score when reasoner-output is already filled | In agent-template mode `run` stops after the reason stage even when a filled `reasoner-output.json` is sitting on disk, so the user gets no score from the flagship command. | 2026-08-18 |
| BL-015 | Dedupe extractMethodFromTarget | One helper next to `matchers.ts` now; eventually persist `calledMethod` from ts-morph at extract time instead of re-regexing `AssertionNode.target`. | 2026-08-18 |
| BL-018 | Validate transitiveInferences against the dependency graph | `mutation-resilience` credits LLM-claimed call paths without checking they exist; `getTransitivePaths` answered this but was deleted in BL-010 (recoverable from git). Granularity mismatch to design: graph is class-level, inferences name `Class.method`. Same item: `confidence` is collected but excluded from the adjustment, so confident and hesitant inferences weigh the same. | 2026-08-25 |
| BL-019 | Harden --bug-threshold like --min-score | BL-010 hardened `--min-score` (rejects unparseable and out-of-range, validates before the pipeline) but left `--bug-threshold` on `parseInt` two lines away in the same two functions: `--bug-threshold 5abc` silently gates at 5, `abc` never fires. It is also still resolved after the pipeline. Adjacent numeric parsers with opposite strictness and no reason. | 2026-08-25 |
| BL-020 | Decouple run.spec tests from the repo's own config | Five pre-existing tests in `run.spec.ts` (:30-73, :118-141) pass `--root PROJECT_ROOT`, so since BL-010 they load `deepcover.config.ts`'s `thresholds.composite: 60`. Tests whose subjects are report formatting and `--bug-threshold` will flip to exit 1 if the repo's own score drifts below 60, failing with a message about the wrong thing. Nothing fails today. Fix: isolated root, as BL-010's new tests already do. | 2026-08-25 |
| BL-021 | Single source for the maxInfluence default | The 0.2/20 default now lives in five places: `scorer/index.ts:48`, `extract-stage.ts:99`, and three sub-scorer signature defaults. The three `= 20` parameter defaults are unreachable in production (`runScorer` always passes a value) — dead defaults that drift. Changing the scorer default alone would make the agent README quote a cap the scorer does not apply. One exported constant fixes all of it. | 2026-08-25 |
| BL-022 | Agent README misstates non-round influence caps | `extract-readme.ts:10` uses `Math.round(maxInfluence * 100)`, so `0.125` tells the agent "±13%" while the scorer caps at 12.5 points — a rounding error in the one sentence whose purpose is accuracy, in text that instructs an LLM. | 2026-08-25 |
| BL-024 | Shared base for callable-walking bug detectors | All 5 detectors in `bug-detector/detectors/` open `detect()` with the identical `classFileOwners` + `allCallables(mod)` + `CallableScope` construction skeleton. A `CallableDetector` base class makes the scope-identity construction unrepresentable-wrong for a 6th detector. Found by a finding-reusable-modules audit. | 2026-08-26 |
| BL-025 | Unify CLI report-and-gate tail (analyze/run) | `analyze.ts` and `run.ts` duplicate ~22 lines of format switch + `minScore`/`bugThreshold` gating + exit code, and have already diverged: `analyze` validates `--format` up front, `run` does not, so `deepcover run --format jsonn` silently prints a terminal report instead of erroring. Found by a finding-reusable-modules audit. | 2026-08-26 |
| BL-026 | Single source for criticality derivation | `getCriticality` (`composer.ts`) and `getMethodRisk` (`gap-generator.ts`) are identical bodies (LLM rating lookup, else `branchCount + externalCalls` thresholds); `criticality.ts`'s `getCriticalityFromLLM` is the same lookup without the fallback. Drift here would label the same method differently in the per-method score vs. the gap ranking. Found by a finding-reusable-modules audit. | 2026-08-26 |
| BL-027 | Generic array-job runner in reasoner | The 4 reasoner jobs (domain states, assertion quality, criticality, transitive coverage) share an identical parse→validate→degrade-to-`[]` body, differing only in prompt pair and Zod schema. A private `runArrayJob<T>` helper collapses 4 six-line bodies to 4 one-liners; the `bugFinding` job stays separate (object shape, different failure semantics). Found by a finding-reusable-modules audit. | 2026-08-26 |
| BL-028 | Move reasonerScope out of cli/ into reasoner/scope.ts | The `{ module, wholeRepo: !module && !file }` construction is duplicated in `extract-stage.ts` and `run-pipeline.ts` because `pipeline/` cannot import `cli/` (documented layering rule), which is where the one existing helper (`cli/reasoner-scope.ts`) lives. Relocating it next to `ReasonerScope` removes the duplication at its source. Found by a finding-reusable-modules audit. | 2026-08-26 |
| BL-029 | Extractor and scope gate resolve duplicate class names against different maps | `resolveClassMethodKey` breaks ties with `ClassMethodOwners` (files declaring that class *with that method*); `testInScopeOf` uses `ClassFileOwners` (files declaring that class name *at all*). They can disagree. Live repro: `a/svc.ts` has `class Svc { create() }`, `b/svc.ts` has `class Svc { ship() }`, a spec imports `Svc` from `b/` and calls `create` — the extractor credits `a/svc.ts:Svc.create` (scores covered, `untested: []`) while the gate resolves the test to `b/svc.ts` and rejects it, so the method gets zero assertions. Pre-existing: head and base are byte-identical on the fixture. Found by BL-023's final whole-branch review. | 2026-08-26 |

## In Progress

| ID | Title | Handoff | Branch |
|----|-------|---------|--------|
| BL-023 | Extract scoped test-inventory traversal | [PR #9](https://github.com/anatolykhelmer/deepcover/pull/9) open; [spec](../superpowers/specs/2026-08-26-scoped-test-inventory-design.md) / [plan](../superpowers/plans/2026-08-26-scoped-test-inventory.md) | `scoped-test-inventory` |

## Done

| ID | Title | Completed | Notes |
|----|-------|-----------|-------|
| BL-001 | One StateCatalog for aggregate and per-method scores | 2026-08-18 | |
| BL-002 | Validate config and runtime JSON with existing Zod | 2026-08-20 | |
| BL-003 | Callable + CoverageKey instead of class/function dual loops | 2026-08-24 | [PR #7](https://github.com/anatolykhelmer/deepcover/pull/7) merged |
| BL-010 | Wire or delete dead config | 2026-08-25 | [PR #8](https://github.com/anatolykhelmer/deepcover/pull/8); breaking, released as 0.7.0 |
| BL-017 | Rename className to owner in getBranchScaleForState | 2026-08-21 | Subsumed by BL-003 |

## Dropped

| ID | Title | Reason | Dropped |
|----|-------|--------|---------|
| BL-016 | Exact-key dedupe in gap-generator | Superseded: PR #3 review removed the substring guard entirely — after catalog dedupe the check was redundant and harmful. | 2026-08-19 |

## Decision Log

### 2026-08-26 — BL-023 PR open; 0.8.0
- Pushed and opened [PR #9](https://github.com/anatolykhelmer/deepcover/pull/9) against `main`. Released as **0.8.0** — four additive public exports, nothing removed or changed.
- **The `(unreleased)` marker on the 0.7.0 README heading was stale and is now dropped.** `v0.7.0` is tagged on `e594df6` and pushed to origin, so anyone reading the README at the released version was told it wasn't released yet. This is the identical defect PR #8's review caught for `v0.6.1` — twice now, which suggests the tag and the README heading want to move in one step rather than two.

### 2026-08-26 — BL-023 implemented
- Executed via subagent-driven-development across the 7 planned tasks plus one final-review fix wave; 7 commits on `scoped-test-inventory`. Every per-task review came back clean on the first pass — no fix rounds.
- Suite: 623 tests / 617 passing / 6 skipped, vs. 610 / 602 / 8 on `main`. The +13 is the new `test-inventory.spec.ts`; the 2 skip→pass shift is `reporter-entry.spec.ts` gating itself on a built `dist/`, which exists in the working checkout and not in the fresh comparison worktree. Environment, not code. `tsc --noEmit` clean.
- **The evidence that the refactor is behaviour-preserving is a differential harness, not the suite.** The final review ran both versions of the library over 8 fixtures plus the repo's own `src/` and byte-compared every output the migration could move: `testInventory.coverage`, all four reasoner prompts with and without runtime folding, `resolveCoverage` keys, all 51 bug signals, and the full `ScoreResult` including 118 `perFunction` entries — 1.53 MB of JSON, byte-identical. It then proved the harness was not vacuous by breaking the gate in a throwaway worktree (66 and 128 differing lines).
- **One real finding, and it was about a shape the old code could not have.** `testInScopeOf` gated on the negative (`ownerKind !== 'class'`). Under the old `isClass: boolean` there were only two states; `ownerKind` is a growable union, so adding a third kind would have kept `tsc` green at all 8 call sites while silently admitting every test for that kind — the exact failure the gate exists to prevent, reintroduced by the fix for it. Inverted to `=== 'module'` so an unknown kind falls through and fails closed, with a cast-constructed test pinning it (verified to fail against the un-inverted condition).
- Declined: backfilling `Co-Authored-By` on the six code commits. The convention is not enforced on `main` (8 of the last 24 commits lack it) and a history rewrite for a trailer is net-negative.
- Two defects in the plan text, both caught by implementers rather than by review, neither affecting code: it claimed three `continue`s in the `extractor/index.ts` loop (there are two — the third belongs to an unrelated loop above), and its grep expectation said zero hits for `ownerKind === 'class'` when three legitimate pre-existing hits remain in key-selection and display-text logic. The intended assertion — no `isClass:` scope projection survives — does hold at zero.
- BL-029 opened from the review's live repro of the `ClassMethodOwners`/`ClassFileOwners` asymmetry.

### 2026-08-26 — BL-023 planned
- 7-task plan written (`docs/superpowers/plans/2026-08-26-scoped-test-inventory.md`); status → planned. Branch `scoped-test-inventory`.
- Task order is new-module-first, then one task per consumer layer, so every task after the first has an existing suite as its characterization gate and can be rejected without blocking its neighbours. Task 2 must move `find-tests.ts` and all 5 detectors together — deleting `CallableScope` breaks its importers otherwise.
- Detector `inspect()` bodies stay untouched: four detectors get `this.inspect(codeModel, c.node, c, …)`, passing the node and the scope from the same `Callable`. The redundancy is deliberate — collapsing it is BL-024's `detect()` skeleton, and leaving the seam keeps task 2 a retype rather than a restructure. `untested-condition-operand` is the exception: it carries `isClass` as a positional param, so it takes `c: Callable` plus a one-line destructure that leaves the rest of its body alone.
- Verified against source while planning: all `continue` statements at all four collapsed sites sit at the innermost per-test level, so the loop collapse cannot silently change what they skip. Recorded as the plan's one real review risk anyway — it is checked by reading, not by the suite.

### 2026-08-26 — BL-023 designed
- Spec approved: `docs/superpowers/specs/2026-08-26-scoped-test-inventory-design.md`. BL-023 → Ready.
- The three hand-written task-021 gates were compared clause by clause and are **semantically identical**, including the unscoped-for-standalone-functions branch. So this is a pure extraction with no divergence to adjudicate — the value is that the documented limitation becomes one decision with one comment instead of three copies free to drift.
- Design found what the backlog entry missed: `CallableScope` is a lossy restatement of `Callable`, and `{ owner, filePath, isClass: c.ownerKind === 'class' }` is hand-written at **7** sites, every one of them fed by `allCallables`. Retyping the scope's third field to `ownerKind` makes `Callable` satisfy it structurally, so all 7 translations vanish and `CallableScope` is deleted. Deleting the *skeleton* around them stays BL-024's job; the line is drawn there deliberately.
- `allTests` yields a bare `TestNode`, not a `Callable`-style record: no site reads the `describe` block for anything but `.tests`, and only `runtime-matcher` needs the test file's path — which it already has. Input is `TestFileNode[]` rather than `TestInventory`, since `coverage` is never touched.
- Migration is 8 of the 9 traversal sites. `reasoner/scope.ts` is excluded on purpose — a `.some()` over one file, already two levels, with short-circuit.
- Also verified not a defect: `reasoner/scope.ts`'s owner check never resolves a file, unlike the three real gates. It decides which test files reach the LLM, so over-inclusion costs tokens, not correctness. No backlog item opened.
- Exported from `src/index.ts` beside `allCallables`. `export * from './types/code-model'` already publishes `TestNode`/`TestFileNode`/`TestInventory`, so consumers building on the public `CodeModel` currently get a correct callable walk and no test walk — and re-derive the task-021 gate off-repo where no suite can catch it. Additive, so minor rather than patch.
- Two implementation traps recorded in the spec: the three gates use `continue` inside a triple loop, so collapsing the loops changes what `continue` skips (mechanical here, but must be read, not just tested); and `find-tests` must stay a loop rather than `[...allTests()].filter(...)`, which would materialise the whole inventory once per callable across five detectors.

### 2026-08-26 — BL-010 scope corrected by PR #8 review
- Review found three more silent no-ops in the same schema that BL-010 missed: `include`, `exclude`, and `testPattern` were validated by Zod and read by no call site, even though `extractCodeModel` already supported all three. `include` reached the extractor only from `--module`/`--file` via `resolvePaths`.
- Wired rather than deleted or carved out (bb394bc). `include` follows the same flag > config precedence as the score threshold; `exclude` and `testPattern` pass straight through. Fourth breaking change in 0.7.0: anyone with these fields in a config had them ignored and will now have them applied.
- The spec's "every field either changes behavior or leaves" was scoped to the three fields BL-010 named rather than to an inventory of the schema — which is exactly how these three survived a design pass whose whole subject was dead config. Spec amended with a dated note.
- Also split the out-of-range `--min-score` message by direction: a negative gate can never *fire* (silent pass, the dangerous case) while one above 100 can never *pass*; describing both as "can never be met" buried the one that matters.

### 2026-08-26 — BL-023..BL-028 added from finding-reusable-modules audit
- Ran a whole-`src/` finding-reusable-modules audit (72 non-spec files, ~8.3k LOC). 7 candidates survived skeptical validation; 1 (`extractMethodFromTarget` dedup) was already tracked as BL-015 and skipped. The other 6 filed here as Ideas.
- Two native-API rejections verified by execution rather than assumed: ts-morph 27.0.2's `getFirstAncestor`/`getDescendantsOfKind` are exact behavioral matches for this repo's hand-written `hasAwait`/`hasThrow`/ancestor-walk helpers — confirmed against a throwaway in-memory `ts-morph` `Project`, so no backlog item was opened for those; call sites should just switch to the native calls directly.
- BL-023 (scoped test-inventory traversal) and BL-024 (callable-detector base) are the two with real correctness stakes — both guard the task-021 cross-class-attribution rule, currently reimplemented by hand at 3 and 5 sites respectively. BL-025 (CLI report-and-gate) already has a live symptom: `run --format jsonn` silently falls back instead of erroring, unlike `analyze`.
- Explicitly rejected as false positives (see audit's "Do not combine"): a unified JSON-artifact loader (six sites, six different deliberate failure policies), a shared prompt test-file serializer (three prompts, each projecting different fields on purpose), and a blanket CLI try/catch wrapper (per-command try boundaries are load-bearing, per BL-002's ordering fixes).

### 2026-08-25 — BL-010 done; BL-019..BL-022 added
- Implemented via subagent-driven-development across 6 tasks (11 commits on `config-honesty`); final whole-branch review returned MERGE AFTER FIXES with three blocking items, all fixed and re-reviewed clean. Full suite 597 passing / 6 pre-existing skips, `tsc --noEmit` clean.
- **Released as 0.7.0, not 0.6.1.** The final review caught that `v0.6.1` was already tagged and published while the README filed this branch's breaking changes under "0.6.1 (unreleased)" — users on the published 0.6.1 would have read rules that did not apply to them.
- Three breaking changes: `weights` must sum to 1 (so any single-weight override now throws, since the defaults already sum to 1); `--min-score` rejects unparseable and out-of-range values instead of silently not gating (`60abc` used to truncate to 60); a config with `thresholds.composite` now gates where it did not.
- **Key finding, discovered only because the field stopped being dead:** `llmAdjustment` is bounded per sub-scorer at assertion-quality [-10,+10], criticality [-10,+2] asymmetric, mutation-resilience one-sided and the only one reaching the cap, state-coverage always exactly 0. So `maxInfluence` at its 0.2 default binds one sub-score of four. Shipped as-is — the field does change behavior, and deleting a field that works would be worse — but the README now states the per-scorer bounds rather than the old blanket "±20% for each sub-score", which was false for state coverage in both directions.
- Two `--min-score` holes were found by review rather than by the plan: an unparseable flag silently discarded a configured CI gate (a failing build reported as passing), and validation ran after the full pipeline including a paid LLM stage. Both fixed; resolution now lives in one `src/cli/min-score.ts` called from both gate sites, so the hand-copy drift that caused the first one is unrepresentable.
- Repo's own score is 52/100 against its own `thresholds.composite: 60`, so `npm run deepcover` now exits 1. Left alone deliberately — that is information about the repo, not a defect in the gate.
- BL-019..BL-022 opened from findings triaged as non-blocking by the final review.

### 2026-08-25 — BL-010 (planned)
- Wrote the 6-task implementation plan (`docs/superpowers/plans/2026-08-25-config-honesty.md`); status → planned.
- Task order puts the scorer signature change before the plumbing that feeds it, so each task's tests run against a complete unit.
- Verified during planning: the repo's own `deepcover.config.ts` has weights summing to exactly 1.0, so the new constraint does not break it; and no CI workflow runs DeepCover on this repo, so wiring its `thresholds.composite: 60` cannot break CI. The `npm run deepcover` script will start gating at 60 — the plan treats a resulting exit 1 as information to report, not a reason to edit the config.

### 2026-08-25 — BL-010 (designing), BL-018 added
- Brainstormed and approved the design spec (`docs/superpowers/specs/2026-08-25-config-honesty-design.md`); BL-010 → Ready, status `designing`.
- Per-field decisions: `thresholds.composite` becomes the default for `--min-score` (flag overrides); `reasoner.maxInfluence` is threaded into the three scorers that already implement the cap as a hardcoded `20`; the three unused `dependency-graph` exports are deleted.
- `maxInfluence` deliberately does **not** govern `stateCoverage` — that guard is an absolute ceiling tied to Istanbul branch coverage, not a delta cap, and merging the two semantics under one key would replace one lie with another.
- Scope grew during design on two findings. The `config.ts` comment claiming no scorer reads `weights` is false — they reach `composeScore` and are spent in the composite sum. And because the aggregate composite is unclamped (unlike the per-method one), weights summing to 2 yield a score up to 200; BL-002 declined a sum constraint on the now-disproven grounds that the weights were unread. BL-010 adds the constraint, validated post-merge and failing hard per BL-002's philosophy. Consequence accepted: any partial `weights` override now fails, since the defaults already sum to 1.
- BL-018 split out for the transitive-inference validation that BL-010 originally proposed — it changes reported numbers and needs its own design for the class-vs-method granularity mismatch.

### 2026-08-24 — Backlog groom
- Deleted 6 orphan spec/plan pairs (2026-03 to 2026-08-17) that predated the backlog migration and had no corresponding entries.
- All 11 Ideas items lack specs/plans; ready for promotion to Ready + design work.

### 2026-08-24 — BL-003 (merged)
- PR #7 merged to main (8a0f521). Status → Done.

### 2026-08-23 — BL-003 (PR open)
- Implemented via subagent-driven-development across 7 plan tasks + 1 final-review fix wave (11 commits on `callable-node`); full suite green (554/554, 6 pre-existing skips), `tsc --noEmit` clean; whole-branch review: mergeable, no Critical/Important findings.
- Pushed and opened [PR #7](https://github.com/anatolykhelmer/deepcover/pull/7) against `main`. Status → In Progress pending merge.

### 2026-08-21 — BL-003 Task 7 complete; BL-017 subsumed
- Completed Task 7 (final verification) on branch `callable-node`: full type-check clean, all 554 tests passing, residual grep scan shows zero missed migrations.
- Behavior changes implemented and user-approved:
  1. **Unhandled-error-path bug detector scope widened**: previously scanned class methods only; now also scans standalone functions (pinned by regression tests).
  2. **Resolver hardening**: `lookup()`'s standalone-function probe is gated on `className === filePath` to prevent hallucinated class-method names from borrowing a same-named function's coverage (pinned by regression test).
- **BL-017 subsumed by BL-003 Task 3**: `getBranchScaleForState` parameter rename (`className` → `owner`) and collapse (`affectedMethods: string[]` → single `methodName`) completed as part of the core `CallableNode` refactor. BL-017 → Done.

### 2026-08-21 — BL-003 (designing)
- Started BL-003 on branch `callable-node` (off main after PR #6 merge). Brainstorming the design spec; status → designing.

### 2026-08-20 — BL-002 (ready for merge)
- Completed implementation: 5 commits on `config-validation`, PR #4 open.
- Amended the original decision mid-implementation: invalid config now throws `ConfigError` and stops the run (fail-hard) instead of warning and falling back to defaults. The fallback silently changed `reasoner.provider`, making typos in unrelated fields dangerous in CI. Also uncovered and fixed ordering bugs in `extract` and `reason` where config was loaded after (or outside) work/try-catch.
- Status → ready to merge; this is a breaking change for 0.6.0 (marked with `!` in commit).

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
