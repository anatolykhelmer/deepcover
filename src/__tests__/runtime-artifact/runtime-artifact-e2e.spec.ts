import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { extractCodeModel } from '../../extractor';
import { loadRuntimeArtifacts } from '../../pipeline/loaders';
import { resolveCoverage } from '../../resolver';
import type { CoverageProviderId, RuntimeData } from '../../resolver/types';

jest.setTimeout(180000);

const FIXTURE = path.resolve(__dirname, '../../../fixtures/runtime-artifact');
const COVERAGE_FINAL = path.join(FIXTURE, 'coverage', 'coverage-final.json');
const TEST_COUNT = 2;

interface Case {
  provider: CoverageProviderId;
  command: string;
  /** Operand data expected to survive into the resolver. */
  measuresOperands: boolean;
}

const CASES: Record<'jest' | 'vitest', Case[]> = {
  jest: [
    { provider: 'istanbul', command: 'npx jest --coverage', measuresOperands: true },
    // Jest's v8-to-istanbul emits no binary-expr, so operands genuinely are unavailable.
    // This row is what keeps the istanbul-mapper fix non-vacuous: a naive "always keep
    // operands" change passes the vitest v8 row below and fails here.
    { provider: 'v8', command: 'npx jest --coverage --coverageProvider=v8', measuresOperands: false },
    { provider: 'none', command: 'npx jest', measuresOperands: false },
  ],
  vitest: [
    { provider: 'istanbul', command: 'npx vitest run --coverage', measuresOperands: true },
    // @vitest/coverage-v8 4.x remaps through the AST and DOES emit binary-expr.
    { provider: 'v8', command: 'npx vitest run --coverage --coverage.provider=v8', measuresOperands: true },
    { provider: 'none', command: 'npx vitest run', measuresOperands: false },
  ],
};

/**
 * Each cell is executed once and reused across the three assertion layers — six runner
 * invocations in total, not eighteen. The helper throws rather than `expect`s, because a
 * memoized helper would only ever assert on its first caller.
 */
const runs = new Map<string, { outputDir: string; runtime: RuntimeData }>();

function runCase(framework: string, c: Case): { outputDir: string; runtime: RuntimeData } {
  const key = `${framework}-${c.provider}`;
  const cached = runs.get(key);
  if (cached) return cached;

  const outputDir = path.join(FIXTURE, `.deepcover-${key}`);
  fs.rmSync(outputDir, { recursive: true, force: true });

  execSync(c.command, {
    cwd: FIXTURE,
    stdio: 'pipe',
    env: { ...process.env, DEEPCOVER_E2E_OUTPUT_DIR: outputDir },
  });

  const runtimePath = path.join(outputDir, 'runtime.json');
  if (!fs.existsSync(runtimePath)) {
    throw new Error(`${key}: the reporter wrote no runtime.json to ${outputDir}`);
  }

  const result = { outputDir, runtime: JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) };
  runs.set(key, result);
  return result;
}

describe.each(['jest', 'vitest'] as const)(
  'runtime artifact (e2e — real %s run)',
  (framework) => {
    beforeAll(() => {
      if (!fs.existsSync(path.join(FIXTURE, 'node_modules'))) {
        execSync('npm install', { cwd: FIXTURE, stdio: 'pipe' });
      }
      // The 'none' cases below are only meaningful with a coverage file already on disk,
      // so seed one deliberately rather than depending on test order.
      execSync('npx jest --coverage', {
        cwd: FIXTURE,
        stdio: 'pipe',
        env: { ...process.env, DEEPCOVER_E2E_OUTPUT_DIR: path.join(FIXTURE, '.deepcover-seed') },
      });
    });

    it.each(CASES[framework])('$provider: reporter writes a faithful runtime.json', (c) => {
      const { outputDir, runtime } = runCase(framework, c);

      expect(runtime.framework).toBe(framework);
      expect(runtime.coverageProvider).toBe(c.provider);
      expect(runtime.testResults).toHaveLength(TEST_COUNT);

      // Jest reports numPassingAsserts; Vitest's reporter API has no equivalent, and
      // 0 would truncate the static assertion list to nothing downstream.
      const hasAssertionCount = 'assertionCount' in runtime.testResults[0];
      expect(hasAssertionCount).toBe(framework === 'jest');

      // The copy is best-effort, not guaranteed: both reporters' onRunComplete /
      // onTestRunEnd read the runner's coverage-final.json synchronously, and both
      // runners write that file only after invoking custom reporters (see the
      // "best-effort" comments in jest-reporter.ts / vitest-reporter.ts). Whether
      // that leaves a copyable file behind depends on each runner's own cleanup
      // timing, not on DeepCover:
      //   - Jest never deletes the prior coverage-final.json before its own rewrite,
      //     so the previous run's file (here, beforeAll's seed run) is still on disk
      //     when onRunComplete fires, and gets copied — verified by execution.
      //   - Vitest's coverage provider calls `clean()` at the very start of
      //     `vitest run` (before any test executes) and only writes the new report
      //     from `reportCoverage()`, which core Vitest calls strictly *after*
      //     `_testRun.end()` (the hook that fires onTestRunEnd) — see
      //     node_modules/vitest/dist/chunks/cli-api.*.js. So for every Vitest
      //     invocation the directory is guaranteed empty at copy time, regardless
      //     of provider — verified by execution (a coverage-final.json seeded
      //     before the run gets deleted, then rewritten only after the process
      //     would already have copied nothing).
      // This is a real, previously-uncovered gap in DeepCoverVitestReporter (it
      // could copy successfully by hooking onFinishedReportCoverage instead, which
      // Vitest fires after reportCoverage() resolves) — out of scope for this task,
      // which only consumes the reporters, so it is asserted here as-is rather than
      // silently required to be true for Vitest.
      expect(fs.existsSync(path.join(outputDir, 'istanbul-coverage.json'))).toBe(
        framework === 'jest' && c.provider !== 'none',
      );
    });

    it.each(CASES[framework])('$provider: loader reads it back', (c) => {
      const { outputDir } = runCase(framework, c);
      const artifacts = loadRuntimeArtifacts(outputDir);

      expect(artifacts?.runtime?.coverageProvider).toBe(c.provider);

      if (c.provider === 'none') {
        // Non-vacuity: assert the stale file is really there BEFORE asserting it was
        // ignored, or this passes because there was nothing to pick up.
        expect(fs.existsSync(COVERAGE_FINAL)).toBe(true);
        expect(artifacts?.istanbul).toBeUndefined();
        expect(artifacts?.ignoredStaleIstanbul).toBe(true);
      } else {
        expect(artifacts?.istanbul).toBeDefined();
        expect(artifacts?.ignoredStaleIstanbul).toBe(false);
      }
    });

    it.each(CASES[framework])('$provider: resolver folds it into coverage', (c) => {
      const { outputDir } = runCase(framework, c);
      const codeModel = extractCodeModel({
        rootDir: FIXTURE,
        include: ['src/**/*.ts'],
        exclude: ['**/*.spec.ts', '**/node_modules/**'],
        testPattern: ['__tests__/**/*.spec.ts'],
      });
      const resolved = resolveCoverage(codeModel, FIXTURE, loadRuntimeArtifacts(outputDir));

      expect(resolved.hasRuntimeData).toBe(true);
      expect(resolved.coverageProvider).toBe(c.provider);
      expect(resolved.measuresOperands).toBe(c.measuresOperands);

      const allows = resolved.getMethodCoverage('AccessPolicy', 'allows', 'src/access-policy.ts');
      expect(allows).toBeDefined();

      // Jest joins fullName with a space, Vitest with ' > '. Cross-framework matching
      // survives only because runtime-matcher suffix-matches the leaf it() name.
      expect(allows!.runtime?.testNames.length).toBeGreaterThan(0);

      if (c.provider === 'none') {
        expect(resolved.hasIstanbulData).toBe(false);
      } else {
        expect(allows!.istanbul).toBeDefined();
        expect(allows!.istanbul!.binaryExpressions === undefined).toBe(!c.measuresOperands);
      }
    });
  },
);
