import fs from 'fs';
import path from 'path';

export interface DeepCoverConfig {
  include?: string[];
  exclude?: string[];
  testPattern?: string[];
  reasoner?: {
    provider: 'cursor' | 'anthropic' | 'mock' | 'none';
    model?: string;
    apiKey?: string;
    maxInfluence?: number;
  };
  weights?: {
    assertionQuality?: number;
    stateCoverage?: number;
    mutationResilience?: number;
    criticalityWeighting?: number;
  };
  thresholds?: {
    composite?: number;
  };
}

const DEFAULT_CONFIG: DeepCoverConfig = {
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
