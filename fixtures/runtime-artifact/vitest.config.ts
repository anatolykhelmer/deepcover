import { defineConfig } from 'vitest/config';
import DeepCoverVitestReporter from '../../dist/reporter/vitest.js';

const OUTPUT_DIR = process.env.DEEPCOVER_E2E_OUTPUT_DIR || '.deepcover';

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.spec.ts'],
    reporters: ['default', new DeepCoverVitestReporter({ outputDir: OUTPUT_DIR })],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage',
      reporter: ['json'],
      include: ['src/**/*.ts'],
    },
  },
});
