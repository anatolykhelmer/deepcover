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

/**
 * All six cases would otherwise share Jest's and Vitest's identical default coverage
 * directory (`<fixture>/coverage`), so whichever case's runner wrote there LAST — not
 * the case reading it — determines what `istanbul-source.ts`'s live-vs-copy freshness
 * pick actually returns. Reproduced directly: after running the istanbul case followed
 * by the v8 case, `loadRuntimeArtifacts('.deepcover-jest-istanbul').istanbul` contains
 * only `branch`-type entries — the v8 run's data, never `binary-expr` — even though the
 * istanbul run itself measured real operands. `it.each` happening to declare `v8` after
 * `istanbul` is what let the jest/v8 and vitest/v8 resolver rows look correct; swap the
 * declaration order and they would not. So every coverage-collecting case gets its own
 * coverage output directory, nested inside its own already-gitignored `.deepcover-<key>`
 * (the fixture's `.gitignore` covers the `.deepcover-` prefix, so no fixture file needs touching).
 * The `none` cases are the deliberate exception: they must keep reading the shared
 * `<fixture>/coverage` directory that `beforeAll` seeds, since their whole point is
 * confirming a stale file there gets ignored, not measuring anything themselves.
 */
function coverageDirFlag(framework: string, dir: string): string {
  return framework === 'jest'
    ? `--coverageDirectory=${dir}`
    : `--coverage.reportsDirectory=${dir}`;
}

function runCase(framework: string, c: Case): { outputDir: string; runtime: RuntimeData } {
  const key = `${framework}-${c.provider}`;
  const cached = runs.get(key);
  if (cached) return cached;

  const outputDir = path.join(FIXTURE, `.deepcover-${key}`);
  fs.rmSync(outputDir, { recursive: true, force: true });

  const command =
    c.provider === 'none'
      ? c.command
      : `${c.command} ${coverageDirFlag(framework, path.join(outputDir, 'coverage'))}`;

  execSync(command, {
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
      // "best-effort" comments in jest-reporter.ts / vitest-reporter.ts). It can only
      // ever find something to copy when a stale file from an earlier run already sits
      // in the coverage directory this run points at — verified by execution for both
      // runners (seeding a fake coverage-final.json and observing it deleted, then
      // rewritten, entirely after onRunComplete / onTestRunEnd would have already run).
      // Every non-'none' case here gets its own freshly created, single-use coverage
      // directory (see runCase's coverageDirFlag — required so the six runs cannot
      // contaminate each other's live coverage-final.json, see the comment above
      // coverageDirFlag), so there is never a stale file for either runner's copy to
      // find. The copy is real production behaviour, not a mistake in this stand: it
      // is a genuine gap in both reporters (DeepCoverVitestReporter's could be fixed by
      // hooking onFinishedReportCoverage, which core Vitest fires after
      // reportCoverage() resolves) — out of scope here, which only consumes the
      // reporters. Asserted as always-false rather than skipped, so a future change
      // that makes it non-deterministic (e.g. copying opportunistically mid-run) does
      // not go unnoticed.
      expect(fs.existsSync(path.join(outputDir, 'istanbul-coverage.json'))).toBe(false);
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
        if (c.measuresOperands) {
          // Non-vacuity: `binaryExpressions` must actually hold data, not merely be
          // present-but-empty. `allows`'s `role === 'admin' && active` guard is exactly
          // the compound condition a binary-expr branch is emitted for, so a real
          // measuresOperands=true run must produce at least one entry here — an empty
          // array would mean the flag says "measured" while the data says otherwise
          // (e.g. contaminated coverage from a different run's directory).
          expect(allows!.istanbul!.binaryExpressions).toBeDefined();
          expect(allows!.istanbul!.binaryExpressions!.length).toBeGreaterThan(0);
        } else {
          expect(allows!.istanbul!.binaryExpressions).toBeUndefined();
        }
      }
    });
  },
);
