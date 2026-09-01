import type { Reporter, AggregatedResult } from '@jest/reporters';
import type { CoverageProviderId, RuntimeData } from '../resolver/types';

/** @deprecated Renamed to `RuntimeData` in 0.9.0. */
export type DeepCoverRuntimeData = RuntimeData;

/**
 * Jest's `globalConfig.coverageProvider` is `'babel' | 'v8'` — 'babel' is Jest's
 * default and means coverage went through babel-plugin-istanbul, so it maps to
 * `'istanbul'`. `'v8'` maps straight across. Absent (a loosely-typed globalConfig,
 * or a Jest version that omits it) also means `'istanbul'`, since babel is Jest's
 * own default. Unlike the Vitest reporter, Jest's `Reporter` has no `enabled` flag
 * to gate on — a Jest run without `--coverage` produces no coverage data at all
 * for this reporter to see, so there is no `'none'` case here.
 */
function mapJestCoverageProvider(raw: unknown): CoverageProviderId {
  return raw === 'v8' ? 'v8' : 'istanbul';
}

export class DeepCoverReporter implements Pick<Reporter, 'onRunComplete'> {
  private outputDir: string;
  private coverageDirectory: string;
  private coverageProvider: CoverageProviderId;

  constructor(
    globalConfig: { coverageDirectory?: string; coverageProvider?: string } & Record<string, unknown>,
    options?: { outputDir?: string }
  ) {
    this.outputDir = options?.outputDir ?? '.deepcover';
    this.coverageDirectory = globalConfig.coverageDirectory ?? './coverage';
    this.coverageProvider = mapJestCoverageProvider(globalConfig.coverageProvider);
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

    // Best-effort snapshot. Jest has usually not written this file yet for the run
    // we just observed, so the CLI reads the coverage directory directly and falls
    // back to this copy only when it is the fresher of the two.
    const istanbulSource = path.resolve(this.coverageDirectory, 'coverage-final.json');
    if (fs.existsSync(istanbulSource)) {
      fs.copyFileSync(istanbulSource, path.join(dir, 'istanbul-coverage.json'));
    }
  }
}
