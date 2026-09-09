import type { Reporter, AggregatedResult } from '@jest/reporters';
import type { CoverageProviderId, RuntimeData } from '../resolver/types';

/** @deprecated Renamed to `RuntimeData` in 0.9.0. */
export type DeepCoverRuntimeData = RuntimeData;

/**
 * Jest's `globalConfig.coverageProvider` is `'babel' | 'v8'` — 'babel' is Jest's
 * default and means coverage went through babel-plugin-istanbul, so it maps to
 * `'istanbul'`. `'v8'` maps straight across. Absent (a loosely-typed globalConfig,
 * or a Jest version that omits it) also means `'istanbul'`, since babel is Jest's
 * own default.
 *
 * `collectCoverage: false` is the `'none'` case: reporters still run without
 * `--coverage`, and `coverageDirectory` still points at `./coverage`. Treating
 * that as Istanbul would copy leftover `coverage-final.json` and claim this run
 * measured operands it never did. Omitted `collectCoverage` (hand-built test
 * configs) keeps the babel default so existing callers do not change.
 */
function mapJestCoverageProvider(raw: unknown, collectCoverage: boolean | undefined): CoverageProviderId {
  if (collectCoverage === false) return 'none';
  return raw === 'v8' ? 'v8' : 'istanbul';
}

export class DeepCoverReporter implements Pick<Reporter, 'onRunComplete'> {
  private outputDir: string;
  private coverageDirectory: string;
  private coverageProvider: CoverageProviderId;

  constructor(
    globalConfig: { coverageDirectory?: string; coverageProvider?: string; collectCoverage?: boolean } & Record<string, unknown>,
    options?: { outputDir?: string }
  ) {
    this.outputDir = options?.outputDir ?? '.deepcover';
    this.coverageDirectory = globalConfig.coverageDirectory ?? './coverage';
    this.coverageProvider = mapJestCoverageProvider(
      globalConfig.coverageProvider,
      globalConfig.collectCoverage,
    );
  }

  async onRunComplete(
    _contexts: Set<unknown>,
    results: AggregatedResult
  ): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(this.outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const data: RuntimeData = {
      framework: 'jest',
      coverageProvider: this.coverageProvider,
      testResults: [],
      timestamp: new Date().toISOString(),
      coverageDirectory: path.resolve(this.coverageDirectory),
    };

    for (const suite of results.testResults) {
      for (const test of suite.testResults) {
        data.testResults.push({
          testFilePath: suite.testFilePath,
          testName: test.fullName,
          status: (test.status ?? 'skipped') as 'passed' | 'failed' | 'skipped',
          duration: test.duration ?? 0,
          assertionCount: test.numPassingAsserts ?? 0,
        });
      }
    }

    fs.writeFileSync(
      path.join(dir, 'runtime.json'),
      JSON.stringify(data, null, 2)
    );

    // No coverage snapshot is written here, deliberately. Jest's own CoverageReporter
    // writes coverage-final.json from *its* onRunComplete, and core registers it after
    // the loop that adds custom reporters (@jest/core/build/index.js:1208, dispatched
    // in registration order at :307) — a position no user config can change, since the
    // registration sits outside the `reporters` array. This hook can therefore only
    // ever see a *previous* run's file, and copying that is worse than copying nothing:
    // the snapshot would carry a fresh mtime, so istanbul-source.ts's freshness pick
    // would hand back last run's coverage as current the moment the live directory was
    // cleaned. `coverageDirectory` above is the replacement — the CLI resolves the live
    // file from it. The Vitest reporter does write the snapshot, because Vitest exposes
    // onFinishedReportCoverage, which fires after the report is on disk; Jest has no
    // equivalent inside the reporter API.
    //
    // A leftover from before this version still deserves cleanup, though: an older
    // reporter did write this file, and nothing else will ever remove it now that this
    // one no longer touches it on the happy path. Left alone, it would sit on disk
    // permanently and get loaded as current the moment the live directory was absent —
    // the same failure mode the Vitest reporter's onTestRunEnd guards against.
    if (this.coverageProvider !== 'none') {
      try {
        fs.rmSync(path.join(dir, 'istanbul-coverage.json'), { force: true });
      } catch {
        // Best-effort cleanup of a best-effort artifact; a permission error here must
        // not fail an otherwise green test run.
      }
    }
  }
}
