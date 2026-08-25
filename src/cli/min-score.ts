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
  return parsed;
}
