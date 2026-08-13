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

const REMOVED_FLAGS: Array<{
  flag: string;
  replacement: string;
  present: (options: LegacyFlagCarrier) => boolean;
}> = [
  {
    flag: '--no-llm',
    replacement: 'deepcover run --no-llm --module <path>   (or run `extract` and skip `reason`)',
    present: (options) => options.llm === false,
  },
  {
    flag: '--reasoner-input',
    replacement: 'deepcover analyze   — reasoner-output.json is read from .deepcover by default',
    present: (options) => options.reasonerInput !== undefined,
  },
  {
    flag: '--module',
    replacement: 'deepcover extract --module <path>   then   deepcover analyze',
    present: (options) => options.module !== undefined,
  },
  {
    flag: '--file',
    replacement: 'deepcover extract --file <path>   then   deepcover analyze',
    present: (options) => options.file !== undefined,
  },
];

export function assertNoLegacyFlags(options: LegacyFlagCarrier, commandName: string): void {
  for (const { flag, replacement, present } of REMOVED_FLAGS) {
    if (!present(options)) continue;

    throw new Error(
      `\`${flag}\` was removed in DeepCover 0.3.0 — \`${commandName}\` no longer extracts or calls an LLM.\n` +
        `  Use: ${replacement}\n` +
        `  See the migration table in README.md.`,
    );
  }
}
