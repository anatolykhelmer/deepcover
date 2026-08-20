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
 * 0–100 score. The four weights are NOT constrained to sum to 1 — no scorer
 * reads them yet (BL-010), and enforcing a sum here would invent a rule the
 * code does not implement.
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads the raw config object, or warns and returns undefined. */
function readRawConfig(configPath: string): unknown | undefined {
  if (configPath.endsWith('.json')) {
    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
      console.warn(`Warning: could not load ${configPath} — using defaults: ${errorText(err)}`);
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`Warning: could not parse ${configPath} — using defaults: ${errorText(err)}`);
      return undefined;
    }
  }

  try {
    // For .ts/.js, require works under the tsx runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(configPath);
    return mod.default ?? mod;
  } catch (err) {
    // Previously a bare `catch {}` — a config that failed to load was discarded
    // in total silence, which is the worst possible outcome for the user.
    console.warn(`Warning: could not load ${configPath} — using defaults: ${errorText(err)}`);
    return undefined;
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

export function loadConfig(rootDir: string): DeepCoverConfig {
  const candidates = [
    'deepcover.config.ts',
    'deepcover.config.js',
    'deepcover.config.json',
  ];

  for (const candidate of candidates) {
    const configPath = path.resolve(rootDir, candidate);
    if (!fs.existsSync(configPath)) continue;

    // Returns on the first candidate that exists, rather than falling through
    // to the next one: if the user's deepcover.config.ts is broken, silently
    // loading a stale deepcover.config.json instead would be worse than
    // running on documented defaults.
    const raw = readRawConfig(configPath);
    if (raw === undefined) return DEFAULT_CONFIG;

    const result = DeepCoverConfigSchema.safeParse(raw);
    if (!result.success) {
      console.warn(
        `Warning: invalid config in ${configPath} — using defaults:\n${z.prettifyError(result.error)}`,
      );
      return DEFAULT_CONFIG;
    }

    return mergeWithDefaults(result.data);
  }

  return DEFAULT_CONFIG;
}
