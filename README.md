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

# Deterministic analysis — no API key
npx @anatolykhelmer/deep-cover analyze --root /path/to/your/project --module src/your-module --no-llm

# CI gating — fail if score below threshold
npx @anatolykhelmer/deep-cover score --root /path/to/your/project --module src/your-module --no-llm --min-score 60
```

From a source checkout without installing the package:

```bash
npm install && npm run build
npm run deepcover -- analyze --root . --module src --no-llm
```

**For Cursor (agent as Reasoner, no API key):** see [Install for Cursor](#install-for-cursor-recommended).

**For Anthropic API (CLI as Reasoner):** see [Install for Anthropic](#install-for-anthropic).

**Limitations (honest):** DeepCover currently targets **TypeScript** sources and **Jest** tests. Other languages and runners are not supported yet.

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
deepcover init
# → ~/.cursor/skills/deepcover/SKILL.md
```

Share with the team (commit the skill into the repo):

```bash
deepcover init --project
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

The skill runs extract → reason → analyze. You do not need to fill JSON by hand.

**Check it worked:** after `deepcover init`, the skill file above should exist. If the agent ignores the skill, start a new Agent chat or reload Cursor so skills are picked up.

## Install for Anthropic

Use this when you want the CLI to call Anthropic directly (CI, headless, no Cursor). No Cursor skill needed.

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
npx @anatolykhelmer/deep-cover analyze \
  --root /path/to/your/project \
  --module src/your-module

# CI gating
npx @anatolykhelmer/deep-cover score \
  --root /path/to/your/project \
  --module src/your-module \
  --min-score 60
```

The CLI runs extract → Anthropic Messages API → score in one command. Do not pass `--reasoner-input` unless you already have a filled reasoner JSON.

| | Cursor | Anthropic |
|---|---|---|
| Skill / Agent | yes | no |
| API key | not needed | `ANTHROPIC_API_KEY` |
| How to run | Agent: «run deepcover…» | `analyze` / `score` in the terminal |
| `--no-llm` | skips LLM | skips LLM (no API calls) |

## CLI

### `deepcover extract`

Extract the CodeModel and LLM prompts for Cursor-driven analysis.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--output <dir>` | Output directory | `.deepcover` |
| `--bugs` | Include 5th bug-finding prompt + write deterministic `bug-signals.json` | off |

Produces:
- `code-model.json` — structured code model (classes, methods, branches, tests)
- `prompts.json` — LLM prompts for the Cursor agent (4, or 5 with `--bugs`)
- `reasoner-output.json` — empty template for the agent to fill
- `bug-signals.json` — *(with `--bugs`)* deterministic bug detector signals

### `deepcover analyze`

Run the full analysis pipeline and produce a report.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--no-llm` | Skip LLM reasoning (deterministic only) | false |
| `--reasoner-input <file>` | Pre-computed ReasonerOutput JSON (from Cursor agent) | — |
| `--format <fmt>` | Output: `terminal` or `json` | `terminal` |
| `--bugs` | Enable bug-finding (detectors + optional reasoner bugs) | off |
| `--bug-threshold <n>` | Exit `1` if high-risk bugs >= n (requires `--bugs`) | — |

### `deepcover score`

Output only the composite score. Exits with code 1 if below threshold.

| Flag | Description | Default |
|------|-------------|---------|
| `--root <path>` | Project root directory | Current directory |
| `--module <path>` | Module to analyze (relative to root) | — |
| `--file <path>` | Single file to analyze | — |
| `--no-llm` | Skip LLM reasoning | false |
| `--reasoner-input <file>` | Pre-computed ReasonerOutput JSON | — |
| `--min-score <n>` | Minimum passing score (0-100) | 0 |
| `--bugs` | Enable bug-finding analysis | off |
| `--bug-threshold <n>` | Exit `1` if high-risk bugs >= n (requires `--bugs`) | — |

### `deepcover init`

Install the Cursor skill so the agent can run extract → reason → analyze. Full walkthrough: [Install for Cursor](#install-for-cursor-recommended).

| Flag | Description | Default |
|------|-------------|---------|
| *(none)* | Install to `~/.cursor/skills/deepcover/` (personal, all projects) | — |
| `--project` | Install to `./.cursor/skills/deepcover/` (commit and share with the team) | off |

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

Setup: [Install for Cursor](#install-for-cursor-recommended). After that, in Agent chat say **"run deepcover on my webhooks module"** — the skill handles the rest.

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
npx @anatolykhelmer/deep-cover analyze \
  --root . --module src/webhooks \
  --reasoner-input .deepcover/reasoner-output.json
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

DeepCover integrates with Jest to combine static analysis with real runtime coverage data. When Jest data is available, coverage accuracy improves significantly — Istanbul line/branch counts replace heuristic method-to-test mapping, and runtime pass/fail results filter out broken tests.

### Setup

Add the DeepCover reporter to your project's Jest config, and enable coverage:

```json
{
  "reporters": ["default", "@anatolykhelmer/deep-cover/reporter"],
  "collectCoverage": true
}
```

### What gets captured

After each test run, the reporter writes to `.deepcover/`:

| File | Contents |
|------|----------|
| `jest-runtime.json` | Per-test pass/fail status, duration, assertion counts |
| `istanbul-coverage.json` | Istanbul line/branch/function coverage (from `coverage-final.json`) |

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
