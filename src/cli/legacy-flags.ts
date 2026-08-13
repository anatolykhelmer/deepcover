/**
 * Flags removed in 0.3.0, when `analyze`/`score` stopped extracting and stopped
 * calling an LLM. Silently ignoring them would let CI keep reporting a score
 * computed from something other than what the flags asked for, so they fail loudly.
 *
 * Detected from Commander's parsed options, not from `process.argv`: a command
 * invoked programmatically — `command.parseAsync(argv, { from: 'user' })`, which
 * `llm-scope.spec.ts` already does, and which Task 10's `run` command may do too —
 * never appears in the host process's argv, so an argv scan would silently accept
 * the flag and skip the migration hint.
 */
export interface LegacyFlagCarrier {
  /** Commander sets this to `false` only when `--no-llm` was passed, `true` otherwise. */
  llm?: boolean;
  reasonerInput?: string;
  module?: string;
  file?: string;
}

/**
 * `score` prints the bare number a CI gate parses; `analyze` prints a report.
 * A hint that swaps one for the other silently changes what the user's pipeline
 * reads, so every replacement is built from the command that was actually run.
 */
const REMOVED_FLAGS: Array<{
  flag: string;
  replacement: (commandName: string) => string;
  present: (options: LegacyFlagCarrier) => boolean;
}> = [
  {
    flag: '--no-llm',
    replacement: (commandName) =>
      commandName === 'score'
        ? 'deepcover run --no-llm --module <path> --format score --min-score <n>   (or run `extract`, skip `reason`, then `score`)'
        : 'deepcover run --no-llm --module <path>   (or run `extract` and skip `reason`)',
    present: (options) => options.llm === false,
  },
  {
    flag: '--reasoner-input',
    replacement: (commandName) =>
      `deepcover ${commandName}   — reasoner-output.json is read from .deepcover by default`,
    present: (options) => options.reasonerInput !== undefined,
  },
  {
    flag: '--module',
    replacement: (commandName) => `deepcover extract --module <path>   then   deepcover ${commandName}`,
    present: (options) => options.module !== undefined,
  },
  {
    flag: '--file',
    replacement: (commandName) => `deepcover extract --file <path>   then   deepcover ${commandName}`,
    present: (options) => options.file !== undefined,
  },
];

export function assertNoLegacyFlags(options: LegacyFlagCarrier, commandName: string): void {
  for (const { flag, replacement, present } of REMOVED_FLAGS) {
    if (!present(options)) continue;

    throw new Error(
      `\`${flag}\` was removed in DeepCover 0.3.0 — \`${commandName}\` no longer extracts or calls an LLM.\n` +
        `  Use: ${replacement(commandName)}\n` +
        `  See the migration table in README.md.`,
    );
  }
}
