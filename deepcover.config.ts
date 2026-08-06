import type { DeepCoverConfig } from './src/cli/config';

const config: DeepCoverConfig = {
  reasoner: {
    provider: 'cursor',
    maxInfluence: 0.2,
  },

  weights: {
    assertionQuality: 0.30,
    stateCoverage: 0.30,
    mutationResilience: 0.25,
    criticalityWeighting: 0.15,
  },

  thresholds: {
    composite: 60,
  },
};

export default config;
