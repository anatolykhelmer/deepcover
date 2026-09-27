# BL-039 — Mutation Resilience reports 100 on a module where a mutant survives

**Status:** Ready · **Added:** 2026-09-27 · **Blocks:** Show HN launch post (see `docs/superpowers/plans/2026-09-15-hn-launch-post-handoff.md`, Blockers)

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

So on a suite with full branch coverage and strong matchers, the score saturates regardless of whether any single operand is decisive. The case that actually kills this mutant (a test where `arrays` is `undefined`) is exactly per-operand branch data, which `untested-condition-operand` uses. In that run it was **disabled**, because `@vitest/coverage-v8@2.1.5` emits no `binary-expr` branches. The sub-score did not reflect the missing signal either.

README compounds it: the comparison table (`README.md:32`) answers "Would tests catch a mutation?" with **Yes**, while the weights table (`README.md:427`) describes the sub-score honestly as "branch coverage + assertion specificity".

## Options (pick in design)

1. **Feed per-operand data in.** When `binary-expr` branches are available, count non-decisive operands (the ones `untested-condition-operand` flags) as surviving mutants and penalize `base`. When they are not available, say so: lower `confidence`, or mark the sub-score partially applicable, as `untested-condition-operand` already does for itself.
2. **Rename to what it measures.** For example "Branch & Assertion Strength", and fix the README table row. This is cheap and honest, but gives up the mutation framing.
3. **Drop it from the composite** until 1 exists. Its 25% weight gets redistributed.
4. **Actual mutation sampling**, for example a bounded operator-deletion pass on guards, reusing the operand extraction. This is the biggest option and overlaps with Stryker. It is probably a separate item.

1 and 2 are not exclusive: rename now, then earn the name back with 1.

## Acceptance

- On radashi `src/array` (or a fixture reproducing `if (!a || !a.length)` with no `a === undefined` test), the sub-score no longer reports 100, or it is no longer called "Mutation Resilience".
- The README comparison table no longer claims DeepCover answers "Would tests catch a mutation?" unless option 1 or 4 has shipped.
- A paradigm fixture pins the case, so it cannot regress silently.

## Related

- BL-018: unvalidated `transitiveInferences` inflate this same sub-score (+12 here).
- The HN launch handoff's accuracy constraints: DeepCover does not do mutation testing; every mutation in the post was done by hand.
