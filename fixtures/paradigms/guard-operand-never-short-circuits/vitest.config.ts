import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage',
      reporter: ['json'],
      include: ['src/**/*.ts'],
    },
  },
});
