import fs from 'fs';
import path from 'path';
import { DeepCoverReporter } from '../jest-reporter';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DIST_ENTRY = path.join(REPO_ROOT, 'dist/reporter/index.js');

/**
 * Regression guard for "Reporter is not a constructor": Jest loads a custom
 * reporter with `const Reporter = require(path)` and calls
 * `new Reporter(globalConfig, options)`, so the reporter entry module must be
 * the constructor itself, not an object holding a named export.
 */
function assertUsableAsJestReporter(mod: unknown): void {
  expect(typeof mod).toBe('function');

  const Reporter = mod as new (
    globalConfig: { coverageDirectory?: string },
    options?: { outputDir?: string }
  ) => { onRunComplete: unknown };

  const instance = new Reporter({ coverageDirectory: './coverage' }, { outputDir: '.deepcover' });
  expect(instance).toBeInstanceOf(DeepCoverReporter);
  expect(typeof instance.onRunComplete).toBe('function');
}

describe('reporter entry point (source)', () => {
  const entry: unknown = require('../index');

  it('is directly constructible the way Jest instantiates reporters', () => {
    assertUsableAsJestReporter(entry);
  });

  it('still exposes the DeepCoverReporter named export', () => {
    expect((entry as { DeepCoverReporter?: unknown }).DeepCoverReporter).toBe(DeepCoverReporter);
  });

  it('exposes a default export for Jest’s .default fallback', () => {
    expect((entry as { default?: unknown }).default).toBe(DeepCoverReporter);
  });
});

// Runs once `npm run build` has produced dist/ (always the case for the published
// package, which is what Jest actually requires at runtime).
const describeBuilt = fs.existsSync(DIST_ENTRY) ? describe : describe.skip;

describeBuilt('reporter entry point (built dist)', () => {
  it('is directly constructible the way Jest instantiates reporters', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const built: unknown = require(DIST_ENTRY);
    expect(typeof built).toBe('function');

    const Reporter = built as new (
      globalConfig: { coverageDirectory?: string },
      options?: { outputDir?: string }
    ) => { onRunComplete: unknown };
    const instance = new Reporter({ coverageDirectory: './coverage' });
    expect(typeof instance.onRunComplete).toBe('function');
  });

  it('exposes named and default properties on the built module', () => {
    const built = require(DIST_ENTRY) as { DeepCoverReporter?: unknown; default?: unknown };
    expect(typeof built.DeepCoverReporter).toBe('function');
    expect(built.default).toBe(built.DeepCoverReporter);
  });
});
