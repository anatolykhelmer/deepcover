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

### 0. Check for Jest runtime data (recommended)

Before extracting, check whether the target project's Jest config already has the DeepCover reporter wired up:

```json
{
  "reporters": ["default", "@anatolykhelmer/deep-cover/reporter"],
  "collectCoverage": true
}
```

If it's missing, tell the user and offer to add it (both `reporters` and `collectCoverage: true` are required together — one without the other silently loses half the data). Then have them run their test suite with coverage once (e.g. `npm test -- --coverage`) so `.deepcover/jest-runtime.json` and `.deepcover/istanbul-coverage.json` exist before `extract`/`analyze`. Without these files, scoring falls back to static heuristics only — noticeably less accurate for Assertion Quality, State Coverage, Mutation Resilience, and Criticality. This step is optional but strongly recommended; proceed without it only if the user declines.

### 1. Extract

```bash
npx deepcover extract --root <PROJECT_ROOT> --module <MODULE_PATH> --bugs
```

Optional: `--file <path>`. Bug-finding is on by default in this skill (`--bugs` writes `bug-signals.json` and the 5th prompt). CLI still requires the flag; omit it only if the user wants coverage-only.

Outputs under `.deepcover/`:
- `code-model.json`
- `prompts.json` (includes bug-finding)
- `reasoner-output.json` (template — **you fill this**)
- `bug-signals.json`

### 2. Reason (you are the Reasoner)

1. Read `.deepcover/code-model.json` and `.deepcover/prompts.json`.
2. Follow every job in `prompts.json` (domain states, assertion quality, criticality, transitive coverage, and bug-finding). Signals are already embedded in the bug-finding prompt — you do not need to open `bug-signals.json` separately.
3. Write results into `.deepcover/reasoner-output.json` (include `bugFindings`).
4. Every item needs `confidence` (0–1). Prefer a few high-quality insights over many generic ones.
5. If `.deepcover/AGENT_README.md` (or similar agent instructions) exists, follow it.

### 3. Score

```bash
npx deepcover analyze --root <PROJECT_ROOT> --module <MODULE_PATH> \
  --reasoner-input .deepcover/reasoner-output.json --bugs
```

Use `--format json` for machine-readable output. Add `--bug-threshold <n>` when the user wants CI-style gating on high-risk bugs.

## Notes

- Deterministic-only (no LLM): `npx deepcover analyze --root ... --no-llm`
- Coverage-only (skip bug-finding): omit `--bugs` on extract/analyze
- Jest runtime data: `analyze` auto-reads `.deepcover/jest-runtime.json` and `istanbul-coverage.json` when present (see step 0). Report which files were found — if either is missing, say so rather than presenting heuristic numbers as ground truth
- Install for Cursor: `deepcover init --agent cursor` (default). For Claude Code: `deepcover init --agent claude`
- Anthropic API path is optional (`reasoner.provider: 'anthropic'` + `ANTHROPIC_API_KEY`); default is the coding agent as Reasoner. If Anthropic is configured, you may run `npx deepcover reason --root … --module … --bugs` instead of filling `reasoner-output.json` yourself, then `analyze --reasoner-input … --bugs`
- Do not invent coverage numbers — ground claims in the CodeModel and reasoner output
