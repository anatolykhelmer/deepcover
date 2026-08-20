import path from 'path';
import { DeepCoverConfigSchema } from '../config';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

describe('DeepCoverConfigSchema', () => {
  it("accepts this repo's own deepcover.config.ts values", () => {
    const result = DeepCoverConfigSchema.safeParse({
      reasoner: { provider: 'cursor', maxInfluence: 0.2 },
      weights: {
        assertionQuality: 0.3,
        stateCoverage: 0.3,
        mutationResilience: 0.25,
        criticalityWeighting: 0.15,
      },
      thresholds: { composite: 60 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty config', () => {
    expect(DeepCoverConfigSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    const result = DeepCoverConfigSchema.safeParse({ resoner: { provider: 'cursor' } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.code).toBe('unrecognized_keys');
  });

  it('rejects an unknown nested key', () => {
    const result = DeepCoverConfigSchema.safeParse({
      reasoner: { provider: 'cursor', maxinfluence: 0.2 },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.code).toBe('unrecognized_keys');
  });

  it('rejects an unknown provider', () => {
    const result = DeepCoverConfigSchema.safeParse({ reasoner: { provider: 'anthropc' } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['reasoner', 'provider']);
  });

  it('rejects a reasoner section with no provider', () => {
    const result = DeepCoverConfigSchema.safeParse({ reasoner: { model: 'x' } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['reasoner', 'provider']);
  });

  it('rejects maxInfluence outside 0..1', () => {
    const result = DeepCoverConfigSchema.safeParse({
      reasoner: { provider: 'cursor', maxInfluence: 5 },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['reasoner', 'maxInfluence']);
  });

  it('rejects a weight outside 0..1', () => {
    const result = DeepCoverConfigSchema.safeParse({ weights: { assertionQuality: 1.5 } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['weights', 'assertionQuality']);
  });

  it('rejects a composite threshold outside 0..100', () => {
    const result = DeepCoverConfigSchema.safeParse({ thresholds: { composite: 101 } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['thresholds', 'composite']);
  });

  it('rejects a non-array include', () => {
    expect(DeepCoverConfigSchema.safeParse({ include: 'src/**' }).success).toBe(false);
  });

  it("validates the repo's own config file as actually written on disk", () => {
    // Guards against this repo's config drifting past the schema without notice.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(PROJECT_ROOT, 'deepcover.config.ts'));
    const result = DeepCoverConfigSchema.safeParse(mod.default ?? mod);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});
