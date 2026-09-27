# BL-040 — Prove surviving operand deletions from Istanbul's own counts

**Status:** Idea · **Added:** 2026-09-27 · **Follows:** BL-039 (rename now, earn the mutation name back with this)

## The finding

`untested-condition-operand` misses the headline case of the launch post, even with per-operand data. Replaying the inputs radashi's suite actually passes to `unzip` (its own test plus `zip`'s three, which delegate) under `istanbul-lib-instrument`:

```
0 if          line 2 counts [ 1, 3 ]
1 binary-expr line 2 counts [ 4, 4 ]   // if (!arrays || !arrays.length)
```

- *Never evaluated* does not fire, because both operands ran 4 times.
- *Never decisive* does not fire, because it only handles guards that `throw`, and this one returns `[]`.

The detector's doc comment says Istanbul's counts cannot establish decisiveness. For every operand except the last, they can. In a flat `a || b || c` chain, operand *i+1* is evaluated exactly when operand *i* was falsy, so:

- `count[i] − count[i+1]` = the number of evaluations where operand *i* was truthy and short-circuited.
- If that is 0, operand *i* was never truthy on any test input. Deleting it (`a || b` → `b`) gives the same value on every input the suite ever produced, so the mutant **provably survives**.

For `&&`, the same holds with *falsy*.

The **last** operand needs the enclosing branch. When the chain is the whole condition of an `if`/ternary, `taken = Σ truthy(i)` for `||`, so `truthy(last) = taken − Σ_{i<last} (count[i] − count[i+1])`. If that is 0, deleting `|| last` also survives. The launch post's second mutation, `zipToObject.ts:25` (`!keys || !keys.length` → `!keys`), has that shape. Its counts were not checked.

This proof is one-sided. A zero proves a survivor. A non-zero does not prove a kill, because a later operand may still flip the outcome, and a test must also assert on it. So it gives a lower bound on surviving operand deletions, which is the right direction for a penalty.

## Scope

1. **Detector.** Add a *never short-circuits* signal to `untested-condition-operand` from count differences. It is proof from data, so it should get high confidence, like *never evaluated*. It also needs the `if`/ternary path counts for the last operand, which `BinaryExprCoverage` does not carry today.
2. **Sub-score.** Count those proven survivors against the renamed BL-039 sub-score. Restore a mutation framing only for the part it actually measures.
3. **Docs.** Once this ships, README `:37` ("flags the operands you could delete with the suite still green") becomes true for flat chains under Istanbul. BL-039 softens it until then.

## Open questions (resolve before design)

- **Are v8-derived `binary-expr` counts real?** `@vitest/coverage-v8` with AST-aware remapping synthesizes `binary-expr` entries. V8 drops nested ranges whose count equals the parent's. So an operand with no V8 range may inherit the parent count, which would produce an equality the proof would read as "never short-circuited". This must be verified against a real Vitest 3 + v8 run before the signal is trusted on that provider. Until then it may need to be Istanbul-only.
- **Nested or mixed chains** (`a || (b && c)`). `findNeverEvaluated` already skips ambiguous lines. Decide whether the proof does the same or handles one level.
- **Operands with side effects** (getters, calls). Deleting them changes more than the value. This is probably acceptable to ignore; note it.

## Not covered

radashi itself runs `@vitest/coverage-v8@2.1.5`, which emits no `binary-expr` entries at all (974 `branch` entries in its `coverage-final.json`). This item does not make DeepCover catch the launch-post mutant on radashi's own config. It helps Istanbul users and, if the question above resolves well, Vitest 3 v8 users.
