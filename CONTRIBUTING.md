# Contributing to DeepCover

Thanks for contributing. This doc covers local setup and the usual workflows.

## Prerequisites

- Node.js **>= 18**
- npm
- TypeScript + Jest knowledge helps (that's the current analysis target)

## Setup

```bash
git clone <REPO_URL>
cd deep-cover
npm install
npm test
npm run build
```

From a checkout you can also run the CLI without building:

```bash
npm run deepcover -- analyze --root . --module src --no-llm
```

After `npm run build` / install from npm:

```bash
npx deepcover --help
```

## Tests

| Command | Purpose |
|---------|---------|
| `npm test` | Unit + fast paradigm tests |
| `npm run test:watch` | Watch mode |
| `npm run test:paradigms` | Paradigm unit tests only |
| `npm run test:paradigms:e2e` | E2E paradigm fixtures (real Jest runs) |
| `npm run build` | `tsc` → `dist/` |

## Adding a paradigm

Paradigms live under `fixtures/paradigms/`. See the **Paradigm Testing** section in [README.md](./README.md) for the fixture layout, expectations format, and how to capture Istanbul coverage.

## Coding conventions

- TypeScript strict mode
- Prefer small, focused modules under `src/` (extractor / resolver / reasoner / scorer / CLI)
- Add or update `*.spec.ts` next to the code you change
- Keep LLM influence bounded — scorer caps adjustments; don't bypass that in new paths
- No secrets in the repo; use `.env.example` as the template

## Pull requests

- Describe **why**, not only what
- Include a short test plan (commands you ran)
- Keep PRs reviewable; large refactors should be split when possible

## Optional Anthropic provider

Default Reasoner path is Cursor (`extract` → fill `reasoner-output.json` → `analyze`). To use Anthropic:

```bash
npm install @anthropic-ai/sdk
# set ANTHROPIC_API_KEY or reasoner.apiKey in deepcover.config.*
```

Set `reasoner.provider` to `"anthropic"` in config.
