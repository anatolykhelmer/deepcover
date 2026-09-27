# BL-039 — Mutation Resilience reports 100 on a module where a mutant survives

**Status:** Done 2026-09-27 ([PR #20](https://github.com/anatolykhelmer/deepcover/pull/20); option 2, shown in chat and the Decision Log as "option A") · **Added:** 2026-09-27 · **Blocks:** Show HN launch post (see `docs/superpowers/plans/2026-09-15-hn-launch-post-handoff.md`, Blockers)

## The contradiction

On radashi `src/array` (35 functions, 911 tests, 100% line/branch coverage enforced in CI), DeepCover 0.10.1 scored:

```
Mutation Resilience    100     (base 96.95 + LLM 12, capped)
```

The launch post's opening demo is a surviving mutant in that same module: delete `!arrays ||` from `src/array/unzip.ts:16`, run radashi's CI command (`pnpm test`), and all 911 tests pass with coverage still at 100% on the edited file. A reader who sees both facts concludes the sub-score is decorative, which undermines the whole product claim.

## Why it happens (read from `src/scorer/mutation-resilience.ts`)

The sub-score never reasons about mutants:

- `base = (branchFactor + specificityFactor) / 2 * 100`
  - `branchFactor`: hit branches / total branches over tested callables. At 100% branch coverage it is 1.0.
  - `specificityFactor`: mean matcher specificity (`toEqual` > `toBeDefined`). radashi's assertions are strong, so ~0.94.
- `llmAdjustment = min(maxAdjustment, 2 × confirmed transitiveInferences)`. Here +12, and it pushes the score past the cap. It credits LLM-claimed call paths without checking them (BL-018).

So on a suite with full branch coverage and strong matchers, the score saturates regardless of whether any single operand is decisive.

> **Corrected 2026-09-27.** An earlier version of this file said per-operand branch data would have caught this mutant, and that it was only missing because `@vitest/coverage-v8@2.1.5` emits no `binary-expr` branches. The second half is true: radashi's `coverage-final.json` has 974 `branch` entries and zero `binary-expr`. The first half is false. Replaying the suite's inputs to `unzip` under `istanbul-lib-instrument` gives `binary-expr [4, 4]`. Both operands were evaluated, so *never evaluated* does not fire. The guard returns `[]` rather than throwing, so *never decisive* does not fire either. `untested-condition-operand` emits nothing for this guard on any provider. Equal counts do prove the deletion survives, but nothing reads them that way yet; that is BL-040.
>
> The reasoner did see it. The `zip → unzip` transitive inference carries the caveat "zip can never drive the `!arrays` operand; unzip needs its own nullish test", is marked `coveredTransitively: true`, and so contributes +2 of the +12 (BL-018).

The docs overclaim in four places, not one:

- `README.md:32`: the comparison table answers "Would tests catch a mutation?" with **Yes**.
- `README.md:37`: "DeepCover splits the chain and flags the operands you could delete with the suite still green". It did not flag the operand the post deletes, and it would not have with Istanbul data either.
- `README.md:427`: the weights table's "What it measures" cell still leads with "Would tests catch subtle code changes?" before the honest parenthetical.
- `docs/100-percent-coverage-still-green.md:67`: "This run had no per-operand branch data … so that check was disabled rather than guessed." Placed next to the `!arrays ||` demo, it implies the check would have found it.

## Options (pick in design)

1. **Feed per-operand data in.** When `binary-expr` branches are available, count non-decisive operands (the ones `untested-condition-operand` flags) as surviving mutants and penalize `base`. When they are not available, say so: lower `confidence`, or mark the sub-score partially applicable, as `untested-condition-operand` already does for itself.
2. **Rename to what it measures.** For example "Branch & Assertion Strength", and fix the README table row. This is cheap and honest, but gives up the mutation framing.
3. **Drop it from the composite** until 1 exists. Its 25% weight gets redistributed.
4. **Actual mutation sampling**, for example a bounded operator-deletion pass on guards, reusing the operand extraction. This is the biggest option and overlaps with Stryker. It is probably a separate item.

1 and 2 are not exclusive: rename now, then earn the name back with 1.

**Chosen 2026-09-27: option 2 now; option 1 reworked as BL-040.** As written, option 1 would change nothing on this case, because the detector does not flag it (see the correction above). Two of its levers are also no-ops. A sub-score's `confidence` is read by neither the composer nor any reporter. `applicable` is a boolean that drops the whole weight, and no "partially applicable" state exists.

## Acceptance

Restated 2026-09-27. The original first criterion ("no longer reports 100") could be met by fixing BL-018 alone or by `--no-llm`, both giving 96.95, which displays as 97 and is the same contradiction.

- No user-facing surface calls this sub-score "Mutation Resilience" or says it answers whether tests catch a mutation or a subtle change: CLI, JSON, README, agent README, and article. The one exception is the `mutationResilience` key in JSON output and in `weights`, kept for compatibility and documented in the README.
- README `:37` and article `:67` no longer claim or imply that DeepCover flags an operand whose deletion leaves the suite green, beyond what `untested-condition-operand` actually detects: operands never evaluated, and throwing guards whose operand no test varies.
- A paradigm fixture reproduces `if (!a || !a.length) return []`, with tests that never pass a nullish `a`. It pins what DeepCover does and does not say about that guard, so a later change (BL-040) shows up as a deliberate diff rather than silently.
- No reported number changes. This item is naming and claims only.

## Related

- BL-018: unvalidated `transitiveInferences` inflate this same sub-score (+12 here).
- The HN launch handoff's accuracy constraints: DeepCover does not do mutation testing; every mutation in the post was done by hand.
