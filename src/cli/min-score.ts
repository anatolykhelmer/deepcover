import type { DeepCoverConfig } from './config';

/**
 * The composite gate `analyze`, `score`, and `run` all apply.
 *
 * Precedence is flag > config > no gate: a project-wide threshold lives in the
 * repo, a one-off override on the command line, and absent both there is no
 * gate at all — not a gate at 0.
 *
 * Shared rather than repeated at each call site because `run` resolves the gate
 * independently of the `analyze`/`score` pair, and two hand-copied resolutions
 * are two chances for the config half to be dropped from one of them.
 */
export function resolveMinScore(
  flag: string | undefined,
  config: DeepCoverConfig,
): number | undefined {
  if (flag === undefined) return config.thresholds?.composite;

  const parsed = Number(flag.trim());
  if (flag.trim() === '' || !Number.isFinite(parsed)) {
    // Fail hard, matching how an invalid config is treated: since the flag
    // suppresses `thresholds.composite`, anything softer would discard a gate
    // the repo asked for and exit 0 — a failing build reported as passing.
    //
    // `Number`, not `parseInt`, for exactly that reason: parseInt reads '8O' as
    // 8 and '60abc' as 60, so a typo would quietly gate at the wrong number
    // instead of being caught here.
    throw new Error(
      `--min-score expects a number, got '${flag}'. ` +
        'Remove the flag to use thresholds.composite from your config.',
    );
  }
  if (parsed < 0 || parsed > 100) {
    // Same reasoning, same failure: the composite is always 0..100, so a gate
    // outside that range is one that can never fire (below 0) or one that can
    // never pass (above 100). The out-of-range flag still suppresses
    // `thresholds.composite`, so accepting it would again turn a configured
    // gate into a failing build reported as passing.
    //
    // The bound matches `thresholds.composite` in the config schema, which is
    // `z.number().min(0).max(100)`: the flag that overrides the config must not
    // accept what the config would reject. `0` and `100` are both inside it —
    // "never gate" and "must be perfect" are real settings, not typos.
    throw new Error(
      `--min-score expects a number between 0 and 100, got '${flag}'. ` +
        'The composite score is always in that range, so a gate outside it can never be met.',
    );
  }
  return parsed;
}
