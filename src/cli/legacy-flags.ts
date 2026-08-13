/**
 * Flags removed in 0.3.0, when `analyze`/`score` stopped extracting and stopped
 * calling an LLM. Silently ignoring them would let CI keep reporting a score
 * computed from something other than what the flags asked for, so they fail loudly.
 */
const REMOVED_FLAGS: Record<string, string> = {
  '--no-llm': 'deepcover run --no-llm --module <path>   (or run `extract` and skip `reason`)',
  '--reasoner-input': 'deepcover analyze   — reasoner-output.json is read from .deepcover by default',
  '--module': 'deepcover extract --module <path>   then   deepcover analyze',
  '--file': 'deepcover extract --file <path>   then   deepcover analyze',
};

export function assertNoLegacyFlags(argv: string[], commandName: string): void {
  for (const [flag, replacement] of Object.entries(REMOVED_FLAGS)) {
    const present = argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (!present) continue;

    throw new Error(
      `\`${flag}\` was removed in DeepCover 0.3.0 — \`${commandName}\` no longer extracts or calls an LLM.\n` +
        `  Use: ${replacement}\n` +
        `  See the migration table in README.md.`,
    );
  }
}
