# DeepCover

An agentic code coverage analyzer that goes beyond line coverage. DeepCover combines deterministic AST analysis with bounded LLM reasoning to produce a "meaningful coverage" score — measuring whether your tests actually protect your code, not just execute it.

## Why — DeepCover vs. Jest Coverage

Jest with Istanbul tells you **what ran**. DeepCover tells you **what's actually protected**.

100% line coverage doesn't mean your tests are good:

```typescript
it('should create order', async () => {
  const result = await service.createOrder(mockInput);
  expect(result).toBeDefined(); // 100% line coverage, near-useless assertion
});
```

Istanbul reports full coverage for `createOrder`. But that test would still pass if the method returned `null`, an empty object, or a completely wrong order. The assertion is too weak to catch any regression.

### What each tool sees

| Question | Jest/Istanbul | DeepCover Extractor |
|----------|:---:|:---:|
| Was this line executed? | Yes | -- |
| Was this branch hit? | Yes | -- |
| Is the assertion meaningful? | -- | Yes |
| Are all domain states tested? | -- | Yes |
| Would tests catch a mutation? | -- | Yes |
| Which untested code is riskiest? | -- | Yes |
| What's mocked vs. real? | -- | Yes |
| Dependency/transitive coverage? | -- | Yes |

### What DeepCover adds on top of line coverage

- **Assertion strength** — `toBeDefined()` is weak, `toEqual(expected)` is strong, `toHaveBeenCalledWith(...)` verifies interactions. Istanbul can't distinguish these.
- **Branch semantics** — Istanbul knows a branch was hit; the Extractor knows it's a guard clause, error path, or retry condition — and feeds the exact condition expressions to the Reasoner for state discovery.
- **Compound conditions** — `if (a || b)` is four things to test, not one. Istanbul's `binary-expr` counters record how often each operand was *evaluated*, never which one was *decisive*, so a guard entered only through `a` still reports as fully covered. The Extractor splits the chain into its operands and the `untested-condition-operand` detector flags the ones no test ever drives — the operands you could delete with the suite still green.
- **Domain states** — the Reasoner identifies business scenarios, error conditions, and edge cases from branch conditions and test names. Istanbul can't tell you that "HTTP 429 rate limiting" is tested but "token expiry race condition" is not.
- **Dependency graph** — if Controller delegates to Service which delegates to Gateway, the Extractor traces transitive paths. Istanbul treats each file in isolation.
- **Criticality ranking** — a public method with high complexity, external calls, and error handling matters more than a simple getter. Istanbul counts all lines equally.
- **Mock analysis** — detects tests that mock away the very thing they claim to test.

### Better together

DeepCover doesn't replace Jest coverage — it **merges** with it. When both are available, Istanbul provides ground-truth "did this code run?" and the Extractor answers "do the tests actually protect it?" Neither alone gives the full picture.

## Architecture

Four-phase pipeline:

```
                                    ┌─────────────────────┐
                                    │  npm test            │
                                    │  (Jest + Reporter)   │
                                    └────────┬────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                     jest-runtime.json  istanbul-coverage  coverage-final
                     (pass/fail/dur)    .json (line/branch) (Jest default)
                              │              │
Source + Tests ──► [Extractor] ──► CodeModel  │
                    (ts-morph)        │       │
                                     ▼       ▼
                               [Coverage Resolver]
                                     │
                                     ▼
                              ResolvedCoverage
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                                  ▼
              [Reasoner]                          [Scorer]
              (LLM/Cursor)                      (4 sub-scores)
                    │                                  ▼
                    └──────────────────────────► ScoreResult
```

- **Extractor** — Deterministic AST analysis: classes, methods, branches, dependencies, assertions, mocks
- **Coverage Resolver** — Merges static AST analysis with Jest/Istanbul runtime data into unified, class-qualified coverage
- **Reasoner** — LLM semantic analysis with enriched prompts: domain states (with branch conditions + test names + state taxonomy), assertion quality (with target method info), criticality (with blast radius from dependency graph), transitive coverage (with mock detection + intra-class call graph)
- **Scorer** — Deterministic formula: 4 sub-scores with bounded LLM influence (±20%)

## Quick Start

**Prerequisites:** Node.js >= 18, a TypeScript project tested with Jest.

```bash
npm install -g @anatolykhelmer/deep-cover

# One-shot, deterministic — no API key
npx @anatolykhelmer/deep-cover run --root /path/to/project --module src/your-module --no-llm

# CI gating — fail if the score is below the threshold
npx @anatolykhelmer/deep-cover run --root /path/to/project --module src/your-module \
  --no-llm --format score --min-score 60
```

DeepCover runs as three stages that always execute in the same order and always
communicate through files in `<root>/.deepcover/`:

| Stage | Command | Writes | LLM? |
|---|---|---|---|
| 1 | `deepcover extract --module <path>` | `code-model.json`, `prompts.json` | no |
| 2 | `deepcover reason` | `reasoner-output.json` | yes — or a template for your agent |
| 3 | `deepcover analyze` | nothing (prints the report) | no |

`deepcover run` performs all three in one command. Stage 2 is the only stage that
involves an LLM, and it always says which Reasoner it used.

**Strongly recommended:** wire up the [Jest reporter](#jest-integration) and run tests with `--coverage` before analyzing.

**Limitations (honest):** DeepCover targets **TypeScript** sources and **Jest** tests.

## State coverage in 0.6.0 (unreleased)

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

## Migrating to 0.5.0

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

## Migrating to 0.4.0

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

## Migrating from 0.2.x

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

## Install for Cursor (recommended)

DeepCover uses the Cursor agent as the Reasoner — no API key. The npm package and the Cursor skill are separate: installing the CLI does not install the skill.

### 1. Install the CLI

```bash
npm install -g @anatolykhelmer/deep-cover
```

Or without a global install:

```bash
npx @anatolykhelmer/deep-cover --help
```

### 2. Install the Cursor skill (once)

```bash
deepcover init --agent cursor
# same as: deepcover init
# → ~/.cursor/skills/deepcover/SKILL.md
```

Share with the team (commit the skill into the repo):

```bash
deepcover init --agent cursor --project
# → ./.cursor/skills/deepcover/SKILL.md
```

| | Personal (`deepcover init`) | Project (`--project`) |
|---|---|---|
| Where | `~/.cursor/skills/deepcover/` | `./.cursor/skills/deepcover/` |
| Scope | All your projects | This repo only |
| Share | No | Yes — commit and push |

### 3. Run in Cursor Agent

Open the project in Cursor → **Agent** chat (not Ask) → ask:

> run deepcover on src/your-module

The skill runs the equivalent of:

```bash
npx deepcover extract --root <PROJECT_ROOT> --module <MODULE_PATH> --bugs
# agent fills .deepcover/reasoner-output.json
npx deepcover analyze --root <PROJECT_ROOT> --bugs
```

You do not need to fill JSON by hand — the agent does that step for you.

**Check it worked:** after `deepcover init`, the skill file above should exist. If the agent ignores the skill, start a new Agent chat or reload Cursor so skills are picked up.

## Install for Claude Code

Same skill workflow as Cursor — Claude Code is the Reasoner (uses your Claude Code / Anthropic subscription). No separate `ANTHROPIC_API_KEY` for the agent path; do not set `reasoner.provider: 'anthropic'` unless you want the CLI to call the API itself.

### 1. Install the CLI

```bash
npm install -g @anatolykhelmer/deep-cover
```

### 2. Install the Claude Code skill (once)

```bash
deepcover init --agent claude
# → ~/.claude/skills/deepcover/SKILL.md
```

Share with the team:

```bash
deepcover init --agent claude --project
# → ./.claude/skills/deepcover/SKILL.md
```

| | Personal | Project (`--project`) |
|---|---|---|
| Where | `~/.claude/skills/deepcover/` | `./.claude/skills/deepcover/` |
| Scope | All your projects | This repo only |
| Share | No | Yes — commit and push |

### 3. Run in Claude Code

In a Claude Code session on the project, ask:

> run deepcover on src/your-module

The skill runs the equivalent of:

```bash
npx deepcover extract --root <PROJECT_ROOT> --module <MODULE_PATH> --bugs
# agent fills .deepcover/reasoner-output.json
npx deepcover analyze --root <PROJECT_ROOT> --bugs
```

**Check it worked:** the skill file above should exist. If Claude ignores it, restart Claude Code or run `/reload-skills`.

## Install for Anthropic

Use this when you want the CLI to call Anthropic directly (CI, headless, no Cursor/Claude Code agent). No agent skill needed.

### 1. Install the peer dependency

In the project you analyze (or globally alongside the CLI):

```bash
npm install @anthropic-ai/sdk
```

Without the SDK, DeepCover prints a clear install error instead of failing at import time.

### 2. Set the API key

DeepCover reads `ANTHROPIC_API_KEY` from the environment (or `reasoner.apiKey` in config). It does **not** auto-load a `.env` file.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Point config at Anthropic

Create or edit `deepcover.config.ts` in the project root:

```typescript
export default {
  reasoner: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', // optional — this is the default
    // apiKey: process.env.ANTHROPIC_API_KEY, // optional if the env var is set
  },
};
```

### 4. Run (do not pass `--no-llm`)

```bash
npx deepcover run --root <PROJECT_ROOT> --module <MODULE_PATH> --bugs
```

`run` performs extract → reason (Anthropic Messages API) → analyze in one command.

| | Cursor / Claude Code | Anthropic API |
|---|---|---|
| Skill / Agent | yes (`init --agent …`) | no |
| API key | not needed for agent path | `ANTHROPIC_API_KEY` |
| How to run | Agent: «run deepcover…» | `run` in the terminal |
| `--no-llm` | skips LLM | skips LLM (no API calls) |

## CLI

### `deepcover run`

One-shot: extract, reason, and analyze in sequence. Equivalent to running the three stages below back to back.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--output <dir>` | Artifact directory | `.deepcover` |
| `--no-llm` | Skip the reason stage (deterministic only) | false |
| `--format <fmt>` | Output: `terminal`, `json`, or `score` | `terminal` |
| `--min-score <n>` | Exit `1` if the composite score is below this | — |
| `--bug-threshold <n>` | Exit `1` if high-risk bugs >= n (requires `--bugs`) | — |
| `--bugs` | Enable bug analysis across all three stages | off |

### `deepcover extract`

Extract the CodeModel and LLM prompts for Cursor-driven analysis.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--output <dir>` | Artifact directory — see the note below | `<root>/.deepcover` |
| `--bugs` | Include 5th bug-finding prompt + write deterministic `bug-signals.json` | off |

**`--output` is for tooling that reads the artifacts itself.** `analyze` and
`score` always read `<root>/.deepcover` and have no counterpart flag, so
artifacts written elsewhere cannot be scored by DeepCover. (`reason` can be
pointed at a relocated model with `--code-model`, but it still writes and reads
the rest of `<root>/.deepcover`.) Omit `--output` for the normal
`extract → reason → analyze` flow.

Produces:
- `code-model.json` — structured code model (classes, methods, branches, tests)
- `prompts.json` — LLM prompts for the Cursor agent (4, or 5 with `--bugs`)
- `reasoner-output.json` — empty template for the agent to fill
- `bug-signals.json` — *(with `--bugs`)* deterministic bug detector signals

### `deepcover reason`

Run the LLM Reasoner via the configured provider and write `reasoner-output.json` (no scoring).

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--code-model <file>` | Existing CodeModel JSON (skips extract) | — |
| `--output <file>` | Output path | `<root>/.deepcover/reasoner-output.json` |
| `--bugs` | Include bug-finding (`bugFindings`) | off |

Staged CI example:

```bash
npx @anatolykhelmer/deep-cover extract --module src/orders
npx @anatolykhelmer/deep-cover reason  --module src/orders --bugs
npx @anatolykhelmer/deep-cover score   --min-score 60 --bugs
```

`--code-model .deepcover/code-model.json` can replace `--module` on `reason` if `extract` already ran.

### `deepcover analyze`

Score the artifacts already on disk in `.deepcover/` and produce a report. Does not extract
or call an LLM — run `extract` (and `reason`, or fill `reasoner-output.json` yourself) first,
or use `deepcover run` for one-shot.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--format <fmt>` | Output: `terminal`, `json`, or `score` | `terminal` |
| `--min-score <n>` | Exit `1` if the composite score is below this | — |
| `--bugs` | Enable bug-finding (detectors + optional reasoner bugs) | off |
| `--bug-threshold <n>` | Exit `1` if high-risk bugs >= n (requires `--bugs`) | — |

### `deepcover score`

Output only the composite score — alias for `analyze --format score`. Exits with code 1 if
below threshold. Same requirement as `analyze`: it reads artifacts already in `.deepcover/`.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--min-score <n>` | Minimum passing score (0-100) | 0 |
| `--bugs` | Enable bug-finding analysis | off |
| `--bug-threshold <n>` | Exit `1` if high-risk bugs >= n (requires `--bugs`) | — |

### `deepcover init`

Install the agent skill (Cursor or Claude Code) so the agent can run extract → reason → analyze.

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <name>` | Target agent: `cursor` or `claude` | `cursor` |
| `--project` | Install into `./.<agent>/skills/deepcover/` (commit and share) | off |

```bash
deepcover init --agent cursor              # ~/.cursor/skills/deepcover/
deepcover init --agent cursor --project    # ./.cursor/skills/deepcover/
deepcover init --agent claude              # ~/.claude/skills/deepcover/
deepcover init --agent claude --project    # ./.claude/skills/deepcover/
```

Walkthroughs: [Install for Cursor](#install-for-cursor-recommended) · [Install for Claude Code](#install-for-claude-code).

## Scoring Model

Four sub-scores combined with configurable weights:

| Sub-score | Weight | What it measures |
|-----------|--------|-----------------|
| Assertion Quality | 30% | Are assertions meaningful? (strong > medium > weak matchers, relative to method complexity) |
| State Coverage | 30% | Are all meaningful domain states tested? (purely reasoner-driven — business scenarios, error conditions, edge cases) |
| Mutation Resilience | 25% | Would tests catch subtle code changes? (branch coverage + assertion specificity) |
| Criticality Weighting | 15% | Is the important code tested? (blast radius + business criticality) |

The LLM can adjust each sub-score by at most ±20%, scaled by its confidence. Without LLM (`--no-llm`), you get the deterministic base scores only.

**Smart weight redistribution:** When a sub-score doesn't apply (e.g. state coverage when the Reasoner has no discovered states), its weight is redistributed proportionally to the applicable sub-scores.

**Per-method composite** uses three factors: Istanbul line coverage baseline (up to 30 pts), state score (up to 35 pts), and assertion score (up to 35 pts). Methods with 100% Istanbul line coverage get the full baseline even without direct test assertions.

**Per-method domain states** come from two sources, unioned and deduplicated by state description:

- the **static extractor**, which derives states from enums, union types and parameter guards and attaches them to every method they affect. A static state counts as tested when any method it affects is covered.
- the **Reasoner**, whose `discoveredStates` are keyed by class and method. A reasoner state counts as tested when the Reasoner marked it tested *and* the resolver confirms the method is genuinely covered — a state inside a method no test reaches cannot have been exercised, whatever the model says.

Most services have no type-level states at all, so without the reasoner join a method's state score is 0 and its composite cannot exceed 65 no matter how well tested it is.

**Matcher strength** is one shared taxonomy (`src/scorer/matchers.ts`) used by every sub-score and by the per-method rollup:

| Strength | Matchers | Why |
|----------|----------|-----|
| Strong | `toEqual`, `toStrictEqual`, `toBe`, `toMatchObject`, `toBeCloseTo`, `toThrow`, `toHaveBeenCalledWith`, `toHaveBeenLastCalledWith` | Pins a concrete expected value or call shape |
| Medium | `toContain`, `toMatch`, `toHaveLength`, `toHaveBeenCalledTimes` | Pins a property of the value |
| Weak | `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `toBeNull` | Pins only that something was produced |

The `resolves`, `rejects` and `not` modifiers are unwrapped, so `await expect(p).resolves.toEqual(x)` classifies as `toEqual`.

**Transitive assertion credit:** When an assertion targets a method call (e.g. `expect(user.getName()).toBe('Alice')`), the `getName` method gets credit even though the test targets `createUser`. This properly reflects how service-level tests transitively verify data-class methods.

## Example Output

Without Jest runtime data:

```
DeepCover Report
════════════════
Composite Score: 47/100

  Assertion Quality   ██████░░░░  62
  State Coverage      ████░░░░░░  38
  Mutation Resilience ████░░░░░░  41
  Criticality Weight  █████░░░░░  51

Per-method breakdown:
  ✅ OrderService.getOrders      72  (well-tested)
  ⚠️  OrderService.createOrder    23  (critical, weak tests)
  ❌ OrderService.deleteOrder      0  (no tests)

Top gaps:
  #1 HIGH  OrderService.deleteOrder — "has no test coverage"
  #2 MED   OrderService.createOrder — "only happy path tested"
```

With Jest runtime data (run `npm test -- --coverage` first):

```
DeepCover Report (with Jest runtime data)
═══════════════════════════════════════════
Composite Score: 61/100

  Assertion Quality   ████████░░  78
  State Coverage      █████░░░░░  52
  Mutation Resilience ██████░░░░  63
  Criticality Weight  █████░░░░░  54

Per-method breakdown:
  ✅ OrderService.getOrders      82  (92% lines, 4/5 branches)
  ⚠️  OrderService.createOrder    34  (41% lines, critical, weak tests)
  ❌ OrderService.deleteOrder      0  (no tests)

Top gaps:
  #1 HIGH  OrderService.deleteOrder — "has no test coverage"
  #2 MED   OrderService.createOrder — "partially covered (41% lines, 33% branches)"
```

## Configuration

Create `deepcover.config.ts` in your project root:

```typescript
export default {
  reasoner: {
    provider: 'cursor',       // 'cursor' | 'anthropic' | 'mock' | 'none'
    // model: 'claude-sonnet-4-20250514',  // when provider is anthropic
    // apiKey: process.env.ANTHROPIC_API_KEY,
    maxInfluence: 0.2,        // cap LLM adjustment at ±20%
  },
  weights: {
    assertionQuality: 0.30,
    stateCoverage: 0.30,
    mutationResilience: 0.25,
    criticalityWeighting: 0.15,
  },
  thresholds: {
    composite: 60,
  },
};
```

Also supports `.js` and `.json` config files.

**Anthropic:** set `reasoner.provider` to `'anthropic'` and provide a key. Full walkthrough: [Install for Anthropic](#install-for-anthropic).

## Using with Cursor

Setup: [Install for Cursor](#install-for-cursor-recommended) (Claude Code: [Install for Claude Code](#install-for-claude-code)). After that, in the agent say **"run deepcover on my webhooks module"** — the skill handles the rest.

### How it works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  CLI extract │────▶│ Cursor Agent │────▶│ CLI analyze  │
│  (Phase 1)   │     │  (Phase 2)   │     │  (Phase 3)   │
│  CodeModel   │     │  Reasoning   │     │  Final Score │
└─────────────┘     └──────────────┘     └─────────────┘
```

1. **Extract** — CLI runs AST analysis, outputs CodeModel + prompts to `.deepcover/`
2. **Reason** — Cursor agent reads the CodeModel, performs semantic analysis (domain states, assertion quality, criticality, transitive coverage), writes `reasoner-output.json`
3. **Score** — CLI combines deterministic metrics with agent insights, produces the final report

### Manual pipeline (without the skill)

```bash
# Step 1: Extract
npx @anatolykhelmer/deep-cover extract \
  --root . --module src/webhooks

# Step 2: Cursor agent fills .deepcover/reasoner-output.json

# Step 3: Score with insights
npx @anatolykhelmer/deep-cover analyze --root .
```

### Why Cursor over an API?

- **Free** — uses your existing Cursor subscription, no Anthropic/OpenAI key needed
- **Context-aware** — the agent already knows your codebase from the conversation
- **Interactive** — you can ask follow-up questions about the analysis
- **Better insights** — a warm agent with project context beats a cold API call

## Project Structure

```
src/
├── extractor/          # Phase 1: AST analysis (ts-morph)
│   ├── class-analyzer  # Classes, decorators, dependencies
│   ├── method-analyzer # Branches, external calls, async ops, line ranges
│   ├── test-analyzer   # Assertions, mocks, test-to-source mapping
│   ├── dependency-graph# Dependency edges, transitive paths
│   └── index           # Orchestrator → CodeModel
├── resolver/           # Phase 1.5: Coverage resolution
│   ├── types           # IstanbulCoverageData, ResolvedCoverage, MethodCoverage
│   ├── istanbul-mapper # Maps Istanbul statement/branch data onto method line ranges
│   ├── runtime-matcher # Matches Jest runtime test names to extractor TestNodes
│   └── index           # resolveCoverage() — merges static + Istanbul + runtime
├── reasoner/           # Phase 2: LLM semantic analysis
│   ├── prompts/        # Enriched prompt templates (4 jobs with cross-cutting context)
│   ├── providers/      # LLM adapters (mock, anthropic)
│   ├── types           # Zod schemas for LLM output validation
│   └── index           # Orchestrator → ReasonerOutput
├── scorer/             # Phase 3: Scoring engine
│   ├── assertion-quality, state-coverage, mutation-resilience, criticality
│   ├── composer        # Weighted score composition
│   ├── gap-generator   # Prioritized untested scenario list + partial coverage gaps
│   └── index           # Orchestrator → ScoreResult
├── reporter/           # Jest custom reporter (runtime + Istanbul capture)
├── cli/                # Commander CLI (analyze, score, extract)
│   ├── commands/       # analyze, score, extract commands
│   ├── formatters/     # Terminal report formatter
│   └── config          # Config file loader
└── types/              # Shared interfaces (CodeModel)

fixtures/
└── paradigms/          # Acceptance test fixtures (one per paradigm)
    └── dont-test-getters-setters/  # Mini npm project with source, tests, expected.json
```

## Jest Integration

DeepCover works without this section — the Extractor can score a module from static AST analysis alone. But **configuring the Jest reporter and running tests with coverage is strongly recommended**: it's the difference between DeepCover *guessing* which test covers which method and *knowing*, from real Istanbul line/branch data and real pass/fail results. This directly sharpens Assertion Quality, State Coverage, Mutation Resilience, and Criticality (see "How it works" below). Do this once per project and every `analyze`/`score` run after that benefits automatically.

### Setup

Add the DeepCover reporter to your project's Jest config, **and** enable coverage — both are required, together:

```json
{
  "reporters": ["default", "@anatolykhelmer/deep-cover/reporter"],
  "collectCoverage": true
}
```

If you'd rather not turn on coverage by default, keep `collectCoverage` out of the config and always pass `--coverage` when running tests before a DeepCover analysis:

```bash
npm test -- --coverage
npx @anatolykhelmer/deep-cover run --root . --module src/your-module
```

**Both pieces matter independently:**

- Reporter only, no coverage → `jest-runtime.json` is written (pass/fail, durations, assertion counts), but `istanbul-coverage.json` is silently skipped — no error, the file just won't exist and DeepCover falls back to heuristic line/branch estimates.
- Coverage only, no reporter → Jest still writes `coverage/coverage-final.json`, but DeepCover never sees runtime pass/fail data, and nothing gets copied into `.deepcover/`.

You want both configured together to get the full accuracy benefit.

### What gets captured

After each test run, the reporter writes to `.deepcover/`:

| File | Contents |
|------|----------|
| `jest-runtime.json` | Per-test pass/fail status, duration, assertion counts |
| `istanbul-coverage.json` | Istanbul line/branch/function coverage (from `coverage-final.json`, requires `collectCoverage: true`) |

### How it works

1. **Run tests** — `npm test -- --coverage` executes tests and produces both artifacts
2. **Run DeepCover** — the `analyze` / `score` commands auto-detect `.deepcover/jest-runtime.json` and `istanbul-coverage.json`
3. **Coverage Resolver** merges the data:
   - Istanbul data → ground-truth line/branch coverage per method (via line-range overlay)
   - Runtime data → actual pass/fail, assertion counts, test durations
   - Static extractor data → fallback when Jest data is unavailable
4. **Scorer** uses the merged data for more accurate sub-scores:
   - Assertion Quality filters out failed tests, detects runtime assertion count mismatches
   - State Coverage scales by Istanbul branch coverage when available
   - Mutation Resilience uses actual branch hit counts instead of heuristic estimates
   - Criticality scales coverage proportionally by Istanbul line coverage
   - Gap Generator reports "partially covered" methods (< 50% line/branch coverage)

## Paradigm Testing

DeepCover includes acceptance tests that validate the quality of its analysis against known test-coverage paradigms. Each paradigm is a self-contained fixture project with expected qualitative outcomes.

### Current paradigms

| Paradigm | What it validates |
|----------|------------------|
| `dont-test-getters-setters` | A data class with getters/setters and private helpers should score 100 when all methods are exercised through a consuming service's tests |
| `bug-unhandled-error` | A method with a try/catch should flag `unhandled-error-path` when only the happy path is tested |
| `same-method-name-different-class` | Two unrelated classes declaring a same-named method must be scored independently — the untested one must not inherit the other's test credit |
| `compound-guard-operand` | A guard built from four `||` operands that every test enters through the same one should flag `untested-condition-operand`, even though Istanbul reports the `binary-expr` fully covered |
| `compound-guard-operand-covered` | The same guard with a test for the second operand must report nothing — the false-positive guard for that detector |

### Running paradigm tests

```bash
npm run test:paradigms       # Fast — uses pre-computed Istanbul data (~1s)
npm run test:paradigms:e2e   # Full — runs real Jest in fixture projects (~3s)
```

Fast paradigm tests are included in the default `npm test` run. E2E tests run separately.

### Adding a new paradigm

1. Create `fixtures/paradigms/<paradigm-name>/` with source, tests, `jest.config.js`, `package.json`
2. Run `npm test` in the fixture to generate `coverage/coverage-final.json`
3. Copy to `.deepcover/coverage-final.json` and commit
4. Write `expected.json` with qualitative assertions
5. Both test levels pick it up automatically

## Development

```bash
npm test              # Unit + paradigm unit tests
npm run test:watch    # Watch mode
npm run test:paradigms:e2e  # E2E paradigm tests (real Jest runs)
npm run build         # Compile TypeScript
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and PR expectations.

## Tech Stack

- **TypeScript** — strict mode
- **ts-morph** — AST analysis
- **Commander** — CLI framework
- **Zod** — LLM response validation
- **Jest + ts-jest** — testing
- **@anthropic-ai/sdk** — optional peer dependency for Anthropic provider

## License

[MIT](./LICENSE)
