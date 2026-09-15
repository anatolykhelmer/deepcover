<!--
Canonical original. Copy the markdown below (not this comment) to Dev.to, then set:
  Canonical URL: https://github.com/anatolykhelmer/deepcover/blob/main/docs/100-percent-coverage-still-green.md
  Tags: testing, typescript, javascript, opensource
Leave the post public. Do not syndicate to Medium as the primary URL.
-->

# I deleted a condition from a library with 100% coverage. CI stayed green.

I deleted `!arrays ||` from a guard in [radashi](https://github.com/radashi-org/radashi), a TypeScript utility library that gates CI on 100% line and branch coverage:

```ts
// before
if (!arrays || !arrays.length) {
// after
if (!arrays.length) {
```

Then I ran their actual CI command, `pnpm test`. All 911 tests passed. Coverage still reported 100% lines and 100% branches — including on `unzip.ts`, the file I had just edited.

That isn't a radashi problem. Their suite is better than most I read. Coverage counts how often an operand is *evaluated*, never whether it *decided* anything. A suite can sit at 100% and still let you delete a condition.

I picked radashi for that reason, not because it is famous. It enforces `thresholds: { 100: true }` in Vitest. If a suite gated at 100% still has a deletable condition, the metric is the problem.

## What coverage cannot say

`if (!arrays || !arrays.length)` is two questions. A V8 coverage provider typically records that the branch ran. It does not record whether `!arrays` ever did any work. If every test already passes a defined array, you can delete the nullish check and the score does not move.

The suite is not a paper tiger. Blanking an unrelated guard in `replaceOrAppend` to `if (false)` failed a test. The harness kills mutants. It just does not kill this one.

## DeepCover

I wrote [DeepCover](https://github.com/anatolykhelmer/deepcover) to score whether tests actually verify the code, not whether they executed a line. Three stages:

**extract** — parses a module into a code model: every branch with `||` / `&&` operands split apart, every test mapped to the function it targets, the dependency graph, per-function coverage merged in. Optional Jest/Vitest reporters add per-test pass/fail.

**reason** — your coding agent gets structured prompts against that model: which domain states exist and which are tested, how strong each assertion is, how critical each function is, what's covered transitively, and where tests create false confidence. The agent writes typed JSON. You are not pasting files into a chat.

**analyze** — composite plus sub-scores, per-function breakdown, ranked gaps. LLM influence is capped at ±20% per sub-score so the number does not swing with model mood.

On radashi's `src/array` — 35 functions, 911 tests, 100% coverage:

```
Composite 89/100
  Assertion Quality  100
  State Coverage      63   ← 37 of 112 domain states untested
```

A domain state is a situation the function's logic can be in — empty vs non-empty, a filter that removes everything, a custom matcher — not "this line ran." The tests that exist are written well. About a third of the states the reasoner found have no test at all. Line coverage cannot say that.

I probed a few of those gaps by inserting a `throw` and re-running the suite. It stayed green for `iterate` with `count <= 0`, and for `select` when a non-empty input is filtered to nothing. The state is in the source. No test ever puts the function there.

## A team that already knew

[radash](https://github.com/sodiray/radash), the library radashi forked from, cannot toggle *any* falsy value out of a list: `0`, `''`, and `false` are all treated as missing. radashi found that, fixed it, and added a test named `'should work with falsy values'` covering `0` and `null`. CI still gates on 100% coverage.

The last falsy case is still wrong. Both `toggle` and `selectFirst` use `Array.prototype.find`, which returns `undefined` for "nothing matched" *and* for "the matching element is `undefined`". A matcher that hits `undefined` looks like a miss: `toggle` appends instead of removing, `selectFirst` never runs the mapper.

The extract step put those operands and tests next to each other. The reasoning step flagged both. I opened [radashi#482](https://github.com/radashi-org/radashi/issues/482) and [radashi#483](https://github.com/radashi-org/radashi/issues/483). The repro is narrow — you need an `undefined` element, and for `toggle` a custom key function — and that is the point. A team that already knew about this class of bug, named a test after it, and enforced 100% coverage still missed one. Coverage had nothing left to say.

## Honest limits

The full score uses a coding agent as the reasoner. This is not a linter you drop into CI unattended (`--no-llm` is deterministic-only).

The deterministic bug pass is noisy on purpose. The reasoning pass validates each signal; on this run it rejected all seven as false positives.

This run had no per-operand branch data (Vitest 2's v8 provider), so that check was disabled rather than guessed. The deleted `!arrays ||` above is a hand edit I ran against their suite, not a mutation-testing feature.

```
npx @anatolykhelmer/deep-cover@0.10.1 run --root . --module src/foo
```

I wrote it: [github.com/anatolykhelmer/deepcover](https://github.com/anatolykhelmer/deepcover)
