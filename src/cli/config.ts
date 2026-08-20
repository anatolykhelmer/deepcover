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

export function loadConfig(rootDir: string): DeepCoverConfig {
  const candidates = [
    'deepcover.config.ts',
    'deepcover.config.js',
    'deepcover.config.json',
  ];

  for (const candidate of candidates) {
    const configPath = path.resolve(rootDir, candidate);
    if (fs.existsSync(configPath)) {
      if (candidate.endsWith('.json')) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
      // For .ts/.js, try require (works with tsx runtime)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(configPath);
        const config = mod.default ?? mod;
        return { ...DEFAULT_CONFIG, ...config };
      } catch {
        // Fall through to default
      }
    }
  }

  return DEFAULT_CONFIG;
}
