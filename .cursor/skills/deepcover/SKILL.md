---
name: deepcover
description: >-
  Run DeepCover meaningful-coverage analysis on a TypeScript + Jest project.
  Use when the user asks to run deepcover, analyze test quality, assertion
  strength, domain-state coverage, or meaningful coverage for a module/file.
---

# DeepCover

Orchestrate the extract → reason → analyze pipeline. Prefer the installed CLI (`npx deepcover`); from this repo's source use `npm run deepcover --`.

## Workflow

### 1. Extract

```bash
npx deepcover extract --root <PROJECT_ROOT> --module <MODULE_PATH>
```

Optional: `--file <path>`, `--bugs` (adds bug-finding prompt + deterministic signals).

Outputs under `.deepcover/`:
- `code-model.json`
- `prompts.json`
- `reasoner-output.json` (template — **you fill this**)
- optionally `bug-signals.json` when `--bugs`

### 2. Reason (you are the Reasoner)

1. Read `.deepcover/code-model.json` and `.deepcover/prompts.json`.
2. Follow every job in `prompts.json` (domain states, assertion quality, criticality, transitive coverage; plus bug-finding when present).
3. Write results into `.deepcover/reasoner-output.json`.
4. Every item needs `confidence` (0–1). Prefer a few high-quality insights over many generic ones.
5. If `.deepcover/AGENT_README.md` (or similar agent instructions) exists, follow it.

### 3. Score

```bash
npx deepcover analyze --root <PROJECT_ROOT> --module <MODULE_PATH> \
  --reasoner-input .deepcover/reasoner-output.json
```

Add `--bugs` / `--bug-threshold <n>` when bug-finding was enabled. Use `--format json` for machine-readable output.

## Notes

- Deterministic-only (no LLM): `npx deepcover analyze --root ... --no-llm`
- Jest runtime data: if the project uses `DeepCoverReporter`, analyze auto-reads `.deepcover/jest-runtime.json` and `istanbul-coverage.json`
- Anthropic API path is optional (`reasoner.provider: 'anthropic'` + `ANTHROPIC_API_KEY`); default is Cursor as Reasoner
- Do not invent coverage numbers — ground claims in the CodeModel and reasoner output
