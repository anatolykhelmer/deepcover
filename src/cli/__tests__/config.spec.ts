import fs from 'fs';
import os from 'os';
import path from 'path';
import { DeepCoverConfigSchema, loadConfig, DEFAULT_CONFIG } from '../config';

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

describe('loadConfig validation', () => {
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

  it('warns and uses defaults for an unknown top-level key', () => {
    const config = loadConfig(jsonDir({ resoner: { provider: 'mock' } }));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('invalid config');
    expect(message).toContain('resoner');
  });

  it('warns and uses defaults for an unknown provider, naming the path', () => {
    const config = loadConfig(jsonDir({ reasoner: { provider: 'anthropc' } }));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warn.mock.calls[0]![0]).toContain('reasoner.provider');
  });

  it('warns and uses defaults for an out-of-range maxInfluence', () => {
    const config = loadConfig(jsonDir({ reasoner: { provider: 'mock', maxInfluence: 5 } }));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warn.mock.calls[0]![0]).toContain('reasoner.maxInfluence');
  });

  it('warns and uses defaults when reasoner has no provider', () => {
    const config = loadConfig(jsonDir({ reasoner: { model: 'x' } }));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warn.mock.calls[0]![0]).toContain('reasoner.provider');
  });

  it('warns and uses defaults for malformed JSON instead of throwing', () => {
    const dir = configDir('deepcover.config.json', '{ "reasoner": ');
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    expect(warn.mock.calls[0]![0]).toContain('could not parse');
  });

  it('warns and uses defaults when a .ts config throws on load', () => {
    const dir = configDir('deepcover.config.ts', "throw new Error('boom');\n");
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('could not load');
    expect(message).toContain('boom');
  });

  it('names the offending file path in every warning', () => {
    const dir = jsonDir({ resoner: {} });
    loadConfig(dir);
    expect(warn.mock.calls[0]![0]).toContain(path.join(dir, 'deepcover.config.json'));
  });
});
