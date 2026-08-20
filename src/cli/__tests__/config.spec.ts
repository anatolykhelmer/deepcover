import fs from 'fs';
import os from 'os';
import path from 'path';
import { DeepCoverConfigSchema, loadConfig, DEFAULT_CONFIG, ConfigError } from '../config';

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

describe('loadConfig rejects invalid config', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /** A fresh directory per call — Node caches require() by absolute path. */
  function configDir(filename: string, contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-config-'));
    fs.writeFileSync(path.join(dir, filename), contents);
    return dir;
  }

  function jsonDir(config: unknown): string {
    return configDir('deepcover.config.json', JSON.stringify(config));
  }

  it('returns defaults with no warning when no config file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-config-'));
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts a valid .json config without warning', () => {
    const config = loadConfig(jsonDir({ reasoner: { provider: 'mock' } }));
    expect(config.reasoner?.provider).toBe('mock');
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts a valid .ts config without warning', () => {
    const dir = configDir(
      'deepcover.config.ts',
      "const c = { reasoner: { provider: 'mock' as const } };\nexport default c;\n",
    );
    expect(loadConfig(dir).reasoner?.provider).toBe('mock');
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws naming the unknown top-level key', () => {
    const dir = jsonDir({ resoner: { provider: 'mock' } });
    expect(() => loadConfig(dir)).toThrow(ConfigError);
    expect(() => loadConfig(dir)).toThrow(/resoner/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws naming the path of an unknown provider', () => {
    const dir = jsonDir({ reasoner: { provider: 'anthropc' } });
    expect(() => loadConfig(dir)).toThrow(/reasoner\.provider/);
  });

  it('throws for an out-of-range maxInfluence', () => {
    const dir = jsonDir({ reasoner: { provider: 'mock', maxInfluence: 5 } });
    expect(() => loadConfig(dir)).toThrow(/reasoner\.maxInfluence/);
  });

  it('throws when reasoner has no provider', () => {
    const dir = jsonDir({ reasoner: { model: 'x' } });
    expect(() => loadConfig(dir)).toThrow(/reasoner\.provider/);
  });

  it('throws for malformed JSON', () => {
    const dir = configDir('deepcover.config.json', '{ "reasoner": ');
    expect(() => loadConfig(dir)).toThrow(ConfigError);
    expect(() => loadConfig(dir)).toThrow(/could not be parsed/i);
  });

  it('throws when a .ts config throws on load', () => {
    const dir = configDir('deepcover.config.ts', "throw new Error('boom');\n");
    expect(() => loadConfig(dir)).toThrow(/boom/);
  });

  it('names the offending file path in the error', () => {
    const dir = jsonDir({ resoner: {} });
    expect(() => loadConfig(dir)).toThrow(
      new RegExp(path.join(dir, 'deepcover.config.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('tells the user how to get back to a working run', () => {
    const dir = jsonDir({ resoner: {} });
    expect(() => loadConfig(dir)).toThrow(/delete it to run with defaults/);
  });
});

describe('loadConfig merge', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function jsonDir(config: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-config-'));
    fs.writeFileSync(path.join(dir, 'deepcover.config.json'), JSON.stringify(config));
    return dir;
  }

  it('keeps the other three default weights when one is overridden', () => {
    const config = loadConfig(jsonDir({ weights: { assertionQuality: 0.5 } }));
    expect(config.weights).toEqual({
      assertionQuality: 0.5,
      stateCoverage: DEFAULT_CONFIG.weights!.stateCoverage,
      mutationResilience: DEFAULT_CONFIG.weights!.mutationResilience,
      criticalityWeighting: DEFAULT_CONFIG.weights!.criticalityWeighting,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the default provider when reasoner specifies only other fields', () => {
    // provider is required by the schema, so the realistic partial case is
    // adding a field alongside it and expecting nothing else to be lost.
    const config = loadConfig(jsonDir({ reasoner: { provider: 'mock', model: 'x' } }));
    expect(config.reasoner).toEqual({ provider: 'mock', model: 'x' });
  });

  it('replaces arrays wholesale rather than concatenating', () => {
    const config = loadConfig(jsonDir({ include: ['src/a.ts'] }));
    expect(config.include).toEqual(['src/a.ts']);
  });

  it('leaves untouched sections at their defaults', () => {
    const config = loadConfig(jsonDir({ thresholds: { composite: 80 } }));
    expect(config.thresholds).toEqual({ composite: 80 });
    expect(config.weights).toEqual(DEFAULT_CONFIG.weights);
    expect(config.reasoner).toEqual(DEFAULT_CONFIG.reasoner);
  });

  it('does not mutate DEFAULT_CONFIG across calls', () => {
    loadConfig(jsonDir({ weights: { assertionQuality: 0.99 } }));
    expect(DEFAULT_CONFIG.weights!.assertionQuality).toBe(0.3);
    const second = loadConfig(jsonDir({}));
    expect(second.weights!.assertionQuality).toBe(0.3);
  });
});
