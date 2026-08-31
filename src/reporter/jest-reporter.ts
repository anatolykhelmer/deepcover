import type { Reporter, AggregatedResult } from '@jest/reporters';
import type { RuntimeData } from '../resolver/types';

/** @deprecated Renamed to `RuntimeData` in 0.9.0. */
export type DeepCoverRuntimeData = RuntimeData;

export class DeepCoverReporter implements Pick<Reporter, 'onRunComplete'> {
  private outputDir: string;
  private coverageDirectory: string;

  constructor(
    globalConfig: { coverageDirectory?: string } & Record<string, unknown>,
    options?: { outputDir?: string }
  ) {
    this.outputDir = options?.outputDir ?? '.deepcover';
    this.coverageDirectory = globalConfig.coverageDirectory ?? './coverage';
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
      coverageProvider: 'istanbul',
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
