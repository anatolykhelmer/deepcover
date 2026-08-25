import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * The runtime source of truth for `deepcover.config.{ts,js,json}`.
 *
 * Strict at every level: a typo'd key is an error rather than a silently
 * ignored no-op, which is the most common real-world config mistake and the
 * only one Zod's default key-stripping would still let through.
 *
 * Ranges follow the documented semantics in README "Configuration":
 * `maxInfluence` and the weights are fractions, `thresholds.composite` is a
 * 0–100 score. The weights must also sum to 1, but that is checked after the
 * merge with the defaults rather than here — see `assertWeightsSumToOne`.
 */
export const DeepCoverConfigSchema = z.strictObject({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  testPattern: z.array(z.string()).optional(),
  reasoner: z
    .strictObject({
      provider: z.enum(['cursor', 'anthropic', 'mock', 'none']),
      model: z.string().optional(),
      apiKey: z.string().optional(),
      maxInfluence: z.number().min(0).max(1).optional(),
    })
    .optional(),
  weights: z
    .strictObject({
      assertionQuality: z.number().min(0).max(1).optional(),
      stateCoverage: z.number().min(0).max(1).optional(),
      mutationResilience: z.number().min(0).max(1).optional(),
      criticalityWeighting: z.number().min(0).max(1).optional(),
    })
    .optional(),
  thresholds: z
    .strictObject({
      composite: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export type DeepCoverConfig = z.infer<typeof DeepCoverConfigSchema>;

export const DEFAULT_CONFIG: DeepCoverConfig = {
  reasoner: { provider: 'cursor' },
  weights: {
    assertionQuality: 0.30,
    stateCoverage: 0.30,
    mutationResilience: 0.25,
    criticalityWeighting: 0.15,
  },
};

/**
 * A config file exists but cannot be honoured. Thrown rather than warned
 * because falling back to defaults silently changes what DeepCover does —
 * most sharply `reasoner.provider`, where a typo elsewhere in the file would
 * quietly run the analysis against a different provider than the one
 * configured. In CI, where a score gates the build, silently-wrong numbers are
 * worse than a stopped run.
 *
 * Every CLI command catches this and prints `message` without a stack trace.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const HOW_TO_RECOVER = 'Fix the config, or delete it to run with defaults.';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads the raw config object, or throws ConfigError explaining why it could not. */
function readRawConfig(configPath: string): unknown {
  if (configPath.endsWith('.json')) {
    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
      throw new ConfigError(`${configPath} could not be read: ${errorText(err)}\n${HOW_TO_RECOVER}`);
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(
        `${configPath} could not be parsed as JSON: ${errorText(err)}\n${HOW_TO_RECOVER}`,
      );
    }
  }

  try {
    // For .ts/.js, require works under the tsx runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(configPath);
    return mod.default ?? mod;
  } catch (err) {
    throw new ConfigError(`${configPath} could not be loaded: ${errorText(err)}\n${HOW_TO_RECOVER}`);
  }
}

/**
 * One level deep, because the config is one level deep. Object sections merge
 * field-by-field so a partially specified section keeps its sibling defaults;
 * array fields replace wholesale, since a user narrowing `include` means to
 * narrow it, not to extend a default.
 */
function mergeWithDefaults(config: DeepCoverConfig): DeepCoverConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ...(DEFAULT_CONFIG.reasoner || config.reasoner
      ? { reasoner: { ...DEFAULT_CONFIG.reasoner, ...config.reasoner } as DeepCoverConfig['reasoner'] }
      : {}),
    ...(DEFAULT_CONFIG.weights || config.weights
      ? { weights: { ...DEFAULT_CONFIG.weights, ...config.weights } }
      : {}),
    ...(DEFAULT_CONFIG.thresholds || config.thresholds
      ? { thresholds: { ...DEFAULT_CONFIG.thresholds, ...config.thresholds } }
      : {}),
  };
}

/**
 * Weights are spent directly in the composite sum (`composer.ts`), and the
 * aggregate composite is not clamped the way the per-method one is. Weights
 * summing to 2 therefore yield a score up to 200, which flows into reports and
 * into whatever gates on them.
 *
 * Checked after the merge, not in the schema: an absent weight is filled from
 * DEFAULT_CONFIG, so only the merged object reflects what the scorer receives.
 * The tolerance absorbs float addition — 0.4 + 0.3 + 0.2 + 0.1 is
 * 0.9999999999999999, and rejecting that would be indefensible.
 */
const WEIGHT_SUM_TOLERANCE = 1e-9;

function assertWeightsSumToOne(config: DeepCoverConfig, configPath: string): void {
  const w = config.weights;
  if (!w) return;

  const entries: [string, number][] = [
    ['assertionQuality', w.assertionQuality ?? 0],
    ['stateCoverage', w.stateCoverage ?? 0],
    ['mutationResilience', w.mutationResilience ?? 0],
    ['criticalityWeighting', w.criticalityWeighting ?? 0],
  ];
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  if (Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE) return;

  // Printing every effective weight matters: because the defaults already sum
  // to 1, overriding a single weight breaks the sum, and the user needs to see
  // that the merge — not their one line — produced the total.
  const shown = entries.map(([k, v]) => `  ${k}: ${v}`).join('\n');
  throw new ConfigError(
    `Invalid config in ${configPath}: weights must sum to 1, but these sum to ${sum}:\n${shown}\n\n` +
      `Weights are spent directly in the composite score, so a different total produces scores off the 0-100 scale.\n${HOW_TO_RECOVER}`,
  );
}

export function loadConfig(rootDir: string): DeepCoverConfig {
  const candidates = [
    'deepcover.config.ts',
    'deepcover.config.js',
    'deepcover.config.json',
  ];

  for (const candidate of candidates) {
    const configPath = path.resolve(rootDir, candidate);
    if (!fs.existsSync(configPath)) continue;

    // Stops at the first candidate that exists rather than falling through to
    // the next one: if the user's deepcover.config.ts is broken, silently
    // loading a stale deepcover.config.json instead would compound the problem.
    const raw = readRawConfig(configPath);

    const result = DeepCoverConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid config in ${configPath}:\n${z.prettifyError(result.error)}\n\n${HOW_TO_RECOVER}`,
      );
    }

    const merged = mergeWithDefaults(result.data);
    assertWeightsSumToOne(merged, configPath);
    return merged;
  }

  return DEFAULT_CONFIG;
}
