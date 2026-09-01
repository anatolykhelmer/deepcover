import fs from 'fs';
import path from 'path';
import type { TestFrameworkId } from './resolver/types';

export interface FrameworkDescriptor {
  id: TestFrameworkId;
  /** Name as it appears in user-facing prose. */
  displayName: string;
  /** Import specifier a user puts in their runner config. */
  reporterSpecifier: string;
  /** One-line instruction for wiring the reporter up. */
  setupHint: string;
}

/**
 * Read only by user-facing text. No analysis path consults this — the extractor
 * accepts both mock dialects unconditionally and the resolver reads whichever
 * artifact is on disk, so nothing downstream needs to know which runner ran.
 */
export const FRAMEWORKS: Record<TestFrameworkId, FrameworkDescriptor> = {
  jest: {
    id: 'jest',
    displayName: 'Jest',
    reporterSpecifier: '@anatolykhelmer/deep-cover/reporter',
    setupHint:
      'Add "@anatolykhelmer/deep-cover/reporter" to `reporters` in your Jest config and run tests with --coverage.',
  },
  vitest: {
    id: 'vitest',
    displayName: 'Vitest',
    reporterSpecifier: '@anatolykhelmer/deep-cover/reporter/vitest',
    setupHint:
      'Add DeepCoverVitestReporter from "@anatolykhelmer/deep-cover/reporter/vitest" to `test.reporters` in your Vitest config, ' +
      'set `test.coverage.provider` to "istanbul", and run tests with --coverage.',
  },
};

/**
 * Last resort, used only when no runtime artifact exists — which is exactly when
 * DeepCover wants to tell the user to wire up a reporter and cannot ask the
 * artifact which one. A project listing both is mid-migration; name the target.
 */
export function detectFramework(rootDir: string): TestFrameworkId | undefined {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  } catch {
    return undefined;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vitest) return 'vitest';
  if (deps.jest) return 'jest';
  return undefined;
}

/**
 * The one message that must name a framework while no artifact exists to ask —
 * so it falls back to the project's declared dependencies, and says nothing
 * rather than guessing wrong when neither runner is declared.
 */
export function missingRuntimeNote(rootDir: string): string {
  const detected = detectFramework(rootDir);
  return (
    'No runtime artifacts in .deepcover — coverage falls back to static heuristics. ' +
    (detected
      ? FRAMEWORKS[detected].setupHint
      : 'Wire up the DeepCover reporter for your test runner and run tests with coverage enabled.')
  );
}
