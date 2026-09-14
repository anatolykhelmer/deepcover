# Changelog

Version history for DeepCover. GitHub Releases carry the same notes.

## [Unreleased]

### Documentation

- README is the landing page (problem, report, one command). Release notes and migrations live here.

## [0.10.0] - 2026-09-09

### Changed

Two fixes on the reporter → loader → resolver path. Both change reported numbers,
so a project's score can move without any change to its code or tests.

**Condition-operand analysis now works under Vitest's default coverage provider.**
DeepCover decided whether per-operand branch data was available by looking at the
recorded provider id, on the assumption that only Istanbul emits `binary-expr`
branches. That holds for Jest's `--coverageProvider=v8`, and not for
`@vitest/coverage-v8`, which remaps v8 output through the AST and does emit them.
Anyone running Vitest's default provider was silently getting no operand half of
`untested-condition-operand` on data that was present. Availability is now derived
from the artifact itself, so those runs gain bug signals they were denied.

### Breaking: a test run without coverage no longer scores the previous run's coverage

When the runtime artifact records `coverageProvider: 'none'`, every coverage file
on disk necessarily belongs to an earlier run. 0.9.0 loaded it and printed a
warning; 0.10.0 refuses it and says so, falling back to static test attribution.
If you run `jest`/`vitest` without `--coverage` and then `deepcover analyze`,
expect a lower, honest score where you previously saw stale numbers — re-run with
`--coverage` to restore them.

Flagged breaking because it changes reported numbers on every affected project,
the same bar 0.9.0 used for its own breaking section below — even though, unlike
that one, no code needs to change to keep compiling.

No public type changes. The exported `ResolvedCoverage` gains an optional
`measuresOperands?: boolean`, which `resolveCoverage()` always sets — so both
callers who use its return value and anyone hand-building the type keep compiling.

## [0.9.0] - 2026-09-02

### Vitest support

DeepCover now works with Vitest as well as Jest. Wire up `DeepCoverVitestReporter` from `@anatolykhelmer/deep-cover/reporter/vitest` in your Vitest config (see [Test-runner integration](./README.md#test-runner-integration)) to get the same runtime-backed accuracy Jest projects have — including, as of 0.9.0, full `untested-condition-operand` detection when coverage runs through `@vitest/coverage-istanbul`. (As of 0.10.0, Vitest's default `v8` provider gets this too, with no config change — see 0.10.0 above.)

**Using the Vitest reporter requires Node >= 20** — Vitest 4 itself only supports Node `^20.0.0 || ^22.0.0 || >=24.0.0`. DeepCover's own Node >= 18 requirement (see [README](./README.md#quick-start)) is unaffected for Jest-only projects.

### The runtime artifact is renamed, and it isn't Jest-specific anymore

Both reporters now write `.deepcover/runtime.json` — previously `.deepcover/jest-runtime.json`, written only by the Jest reporter. **Existing Jest users need to do nothing**: DeepCover's loaders still read the old name too and take whichever of the two files has the newer mtime, so upgrading doesn't lose data and a Jest → Vitest migration doesn't need to delete anything mid-flight. Neither reporter writes the old name going forward.

The exported type follows the same rename: `RuntimeData` replaces `JestRuntimeData` as the canonical name. `JestRuntimeData` remains exported as a deprecated alias of `RuntimeData`, so existing type annotations keep compiling.

### Breaking: two `MethodCoverage` fields are now optional

Two fields reachable from the publicly exported `MethodCoverage` type narrowed from required to optional, both to stop a missing measurement from impersonating a real one:

- `RuntimeTestResult.assertionCount` — absent (not `0`) when the runner doesn't report a per-test assertion count, which is every Vitest run today.
- `IstanbulMethodMetrics.binaryExpressions` — absent (not `[]`) when the coverage provider doesn't measure operands, which **in 0.9.0** was every `v8`-provider run. That determination changed in 0.10.0 (see 0.10.0 above): it's no longer based on the provider id, and most `v8`-provider Vitest runs measure operands now. The field's optionality itself, described here, is unchanged since 0.9.0 — only which runs land on which side of it has moved.

If your code reads either field and does arithmetic or array operations on it without a guard, this is a compile error under `strict` mode. The fix is to handle the "not measured" case explicitly — the same way DeepCover's own scorer and bug-detector now do. This is the one part of 0.9.0 that isn't purely additive.

## [0.8.0] - 2026-08-27

### New public exports

Writing a custom detector or scorer against DeepCover's `CodeModel` used to
mean re-implementing the class-scoping rule that decides which tests count as
evidence about which method — the library exported `allCallables` for walking
source, but nothing for walking tests. Four exports close that gap:

- `allTests(testFiles)` and `testsInFile(file)` walk the test inventory in
  source order, replacing a hand-written `testFiles → describes → tests` loop.
- `testInScopeOf(test, scope, classFileOwners)` is the scoping rule itself: a
  test counts toward a class method only when its resolved `targetClass` is
  that method's owner **and** resolves to that method's own file, so a
  same-named method on an unrelated class — or a second class of the same name
  in another file — cannot inherit the credit. Ownership that cannot be
  established fails closed. Standalone functions carry no per-test class
  signal, so the gate admits every test for them; that limitation is unchanged
  and now documented in one place.
- `TestScope` is the shape `testInScopeOf` matches against. The existing
  `Callable` satisfies it structurally, so a `Callable` from `allCallables`
  passes straight through.

Additive only. No existing export changed, and analysis output is unchanged in
every case — this release moves internal duplication behind a shared module and
publishes it.

## [0.7.0] - 2026-08-26

### Bug detection

The `unhandled-error-path` detector now also scans standalone functions, not
just class methods — a function with a `try/catch` or that throws, and no
test that provokes the error path, now surfaces a signal the same way a
method does. This is new output on existing analyses; nothing else about
`potentialBugs` changed.

### Coverage resolution

A criticality or assertion-quality rating naming a class method that does not
exist could, in a narrow case, silently pick up the coverage of a same-named
standalone function declared in the same file instead of being dropped. Fixed
— such a lookup now correctly resolves to nothing, matching every other
fail-closed path in the resolver.

### Config and CLI

- `weights` must now sum to `1`, checked after merging with your config's
  values and defaults; a mistyped or partial override that doesn't restate
  all four now throws instead of silently skewing the composite.
- `reasoner.maxInfluence` is now threaded to assertion quality and
  criticality weighting, in addition to mutation resilience (see
  [Configuration](./README.md#configuration) for how far each sub-score can actually
  move at a given setting — the default only visibly binds mutation
  resilience). State coverage is deliberately unaffected.
- `thresholds.composite` is now the default for `--min-score` on `analyze`,
  `score`, and `run` — set it once in the config instead of passing the flag
  everywhere. A `--min-score` flag still overrides it. Precedence: flag >
  config > no gate.
- `--min-score` now validates its argument: a value that isn't a finite
  number throws instead of being silently coerced. Notably `--min-score
  60abc` used to be read as `60`; it now fails with an error naming the bad
  value instead of gating at a number you didn't type. It must also be
  within `0..100` — the same bound `thresholds.composite` has always had —
  so `--min-score -5` no longer replaces a configured gate with one that can
  never fire. `0` and `100` remain valid: "never gate" and "must be
  perfect" are real settings. The flag's own `'0'` default was removed since
  `thresholds.composite` (or no gate) now takes over when it's omitted.
- `--min-score` is now resolved and validated **before** the pipeline runs on
  `analyze`, `score`, and `run`, so a typo fails immediately rather than
  after extraction, a paid LLM call, and a printed report.
- **`include`, `exclude`, and `testPattern` now actually apply.** They were
  accepted by the config schema and read by nothing, so `include:
  ['src/foo.ts']` silently analysed the default `**/*.ts` set instead. If you
  have any of these in your config today, this release starts honouring them
  — check that they say what you meant. `--module` and `--file` override
  `include`, matching the flag > config precedence used elsewhere.

## [0.6.1] - 2026-08-23

Patch release. See the [`v0.6.1`](https://github.com/anatolykhelmer/deepcover/releases/tag/v0.6.1) tag.

## [0.6.0] - 2026-08-20

### Config files are validated

`deepcover.config.{ts,js,json}` is now checked against a schema when it loads.
An unknown key, an invalid value, or a file that cannot be read or parsed
**stops the run** with exit code 1, naming the file and every offending key:

```
Invalid config in /project/deepcover.config.json:
✖ Unrecognized key: "resoner"
✖ Invalid option: expected one of "cursor"|"anthropic"|"mock"|"none"
  → at reasoner.provider

Fix the config, or delete it to run with defaults.
```

DeepCover stops rather than falling back to defaults because the fallback
changes what it does — most sharply `reasoner.provider`, where a typo in one
field would quietly run the analysis against a different provider than the one
configured. In CI, where `--min-score` gates the build, silently-wrong numbers
are worse than a stopped run. The check happens before any work, so a failing
run writes no artifacts.

Having **no** config file is still perfectly normal and runs on defaults
silently — this applies only to a config file that exists and cannot be
honoured.

A partially specified section now keeps the defaults for the fields it does not
mention; previously `weights: { assertionQuality: 0.5 }` silently dropped the
other three weights. (Historical note, as of 0.7.0: this example itself no
longer runs as of the weights change documented above — `weights` must now
sum to `1` after merging with defaults, and `{ assertionQuality: 0.5 }`
merged with the other three defaults sums to `1.2`, so it throws. See
[Configuration](./README.md#configuration).)

### State coverage

All four state consumers (aggregate state coverage, per-method scores,
untested lists, gap generation) now read one StateCatalog — the union of
statically extracted states and reasoner-discovered states, with testedness
decided once. Scores will shift on re-analysis:

- The state metric is now **applicable without an LLM run** when the
  extractor finds static states.
- A reasoner state only counts as tested when the resolver confirms its
  method is covered (this floor previously applied per-method but not to
  the aggregate).
- A static state is tested per affected method, not when any affected
  method happens to be covered.
- State gaps are emitted per state×method with unified risk rules; the
  same state found by both sources yields one gap.
- Gap `scenario` for a state is now the bare state name (previously
  static gaps used `state "X" (values)`).
- Reasoner states naming a method or class the code model does not declare
  are dropped from scoring entirely.

## [0.5.0] - 2026-08-16

### Breaking

`ResolvedCoverage`'s accessors — `getMethodCoverage`, `isMethodCovered`,
`getTestsForMethod` — now **require** the `filePath` third argument that 0.4.0
made optional.

```ts
// 0.4.0 — compiled, but fell back to a name-only lookup
coverage.getMethodCoverage('OrderService', 'create');

// 0.5.0 — the declaring file is part of the identity
coverage.getMethodCoverage('OrderService', 'create', 'src/order.service.ts');
```

The optional argument was the problem: omitting it fell back to a
`ClassName.methodName` index that returns nothing once two files declare the
same class name, and every caller read that nothing differently — one as "no
coverage data", another as "untested". Requiring it makes each such site a
compile error instead.

If you only have a class name (for example when consuming Reasoner output,
which names an owner but never a file), resolve it first:

```ts
import { buildClassFileOwners, resolveReasonerOwnerFile } from '@anatolykhelmer/deep-cover';

const owners = buildClassFileOwners(codeModel.modules);
const filePath = resolveReasonerOwnerFile(rating.className, owners);
// null → that class name is declared in several files; drop the judgment
// rather than scoring it against whichever declaration a lookup reaches first
```

Bug detectors now also scan `mod.functions`, so standalone functions produce bug
signals, and every detector scopes test evidence to the declaring file.

## [0.4.0] - 2026-08-14

### Breaking

Internal coverage identity is now file-qualified: class methods are keyed
`filePath:ClassName.methodName` (matching how standalone functions were already
keyed by file), so two files that both export a class with the same name no
longer overwrite each other's coverage.

**Re-run `deepcover extract` (or `run`) after upgrading.** A `code-model.json`
produced by 0.3.x keys class methods as `ClassName.methodName`; the 0.4.0
resolver looks them up file-qualified and would silently find no static
coverage in the old artifact.

For the API, `ResolvedCoverage` accessors (`getMethodCoverage`,
`isMethodCovered`, `getTestsForMethod`) gained an optional `filePath` third
argument. Without it, lookups of a class name declared in several files fail
closed (return nothing) rather than guess. **0.5.0 makes this argument
required** — see above.

Known limitation: when duplicate class names exist, a test's credit is
attributed via the file its spec imports the class from (barrel re-exports are
followed to the declaring file). If the import cannot be resolved statically,
the credit is dropped rather than guessed.

## [0.3.0] - 2026-08-14

### Breaking

Migration from 0.2.x.

`analyze` and `score` no longer extract or call an LLM — they score the artifacts
on disk. The removed flags fail with the replacement command rather than being
ignored.

| 0.2.x | 0.3.0 |
|---|---|
| `analyze --module X --no-llm` | `run --no-llm --module X` |
| `analyze --module X` (API provider) | `run --module X` |
| `analyze --reasoner-input f.json` | `analyze` — `.deepcover/reasoner-output.json` is the default input |
| `score --module X --no-llm --min-score 60` | `run --no-llm --module X --format score --min-score 60` |

`--min-score` and `--bug-threshold` now work with every `--format`, so
`analyze --format json --min-score 60` prints the full report *and* gates on it.

[Unreleased]: https://github.com/anatolykhelmer/deepcover/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.10.0
[0.9.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.9.0
[0.8.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.8.0
[0.7.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.7.0
[0.6.1]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.6.1
[0.6.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.6.0
[0.5.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.5.0
[0.4.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.4.0
[0.3.0]: https://github.com/anatolykhelmer/deepcover/releases/tag/v0.3.2
