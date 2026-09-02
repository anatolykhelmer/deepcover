import type { Reporter } from 'vitest/reporters';
import type { Vitest, TestModule } from 'vitest/node';
import type { CoverageProviderId, RuntimeData } from '../resolver/types';

/**
 * Type-only imports: the class implements Vitest's interface and never calls into
 * it, so `vitest` stays a devDependency and installing DeepCover pulls in no runner.
 * The Jest reporter is built the same way against `@jest/reporters`.
 */
export class DeepCoverVitestReporter implements Reporter {
  private outputDir: string;
  private coverageProvider: CoverageProviderId = 'none';
  private coverageDirectory = './coverage';

  constructor(options?: { outputDir?: string }) {
    this.outputDir = options?.outputDir ?? '.deepcover';
  }

  onInit(vitest: Vitest): void {
    const coverage = vitest.config.coverage;
    // Vitest always resolves `provider` to a real value (default 'v8') regardless
    // of whether coverage actually ran — `enabled` is the only signal that the run
    // measured anything at all. Gate on it first: a disabled run naming a provider
    // would assert something false. 'custom' is likewise unreasoned-about territory.
    this.coverageProvider =
      coverage.enabled && (coverage.provider === 'istanbul' || coverage.provider === 'v8')
        ? coverage.provider
        : 'none';
    this.coverageDirectory = coverage.reportsDirectory;
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(this.outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const data: RuntimeData = {
      framework: 'vitest',
      coverageProvider: this.coverageProvider,
      coverageDirectory: path.resolve(this.coverageDirectory),
      timestamp: new Date().toISOString(),
      testResults: [],
    };

    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        const state = test.result().state;
        // 'pending' means collected but never run — it is not a skip, and giving it
        // one would let an unfinished test count as evidence.
        if (state === 'pending') continue;
        data.testResults.push({
          testFilePath: mod.moduleId,
          testName: test.fullName,
          status: state,
          duration: test.diagnostic()?.duration ?? 0,
          // assertionCount is deliberately absent: Vitest does not report it, and
          // `0` would truncate the static assertion list to nothing downstream.
        });
      }
    }

    fs.writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify(data, null, 2));

    // Best-effort snapshot, mirroring the Jest reporter: the runner has usually not
    // written this yet for the run just observed, so the CLI prefers the live file.
    // Skip when this run did not measure istanbul/v8 coverage: copying would stamp a
    // stale coverage-final.json with a fresh mtime, and a custom provider must not
    // look like a coverage-disabled run that happened to find a leftover file.
    if (this.coverageProvider !== 'none') {
      const istanbulSource = path.resolve(this.coverageDirectory, 'coverage-final.json');
      if (fs.existsSync(istanbulSource)) {
        fs.copyFileSync(istanbulSource, path.join(dir, 'istanbul-coverage.json'));
      }
    }
  }
}
