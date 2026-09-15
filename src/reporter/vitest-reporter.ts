import type { Reporter } from 'vitest/reporters';
import type { Vitest, TestModule } from 'vitest/node';
import type { CoverageProviderId, RuntimeData } from '../resolver/types';

type RuntimeTestResult = RuntimeData['testResults'][number];

/**
 * Vitest 2 reports `pass`/`fail`; Vitest 3+ already uses `passed`/`failed`.
 * `todo` is a skip, not a failure. Unknown states are dropped rather than stored.
 */
const VITEST_2_STATUS: Record<string, RuntimeTestResult['status']> = {
  pass: 'passed',
  fail: 'failed',
  skip: 'skipped',
  todo: 'skipped',
};

/**
 * The File/Task tree Vitest 2.x passes to `onFinished`. Kept local so this file
 * does not import a Vitest 2 type the 4.x `vitest/reporters` entry doesn't export.
 */
type Vitest2Task = {
  type?: string;
  name?: string;
  filepath?: string;
  tasks?: Vitest2Task[];
  result?: { state?: string; duration?: number };
};

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
    const testResults: RuntimeTestResult[] = [];
    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        const state = test.result().state;
        // 'pending' means collected but never run — it is not a skip, and giving it
        // one would let an unfinished test count as evidence.
        if (state === 'pending') continue;
        testResults.push({
          testFilePath: mod.moduleId,
          testName: test.fullName,
          status: state,
          duration: test.diagnostic()?.duration ?? 0,
          // assertionCount is deliberately absent: Vitest does not report it, and
          // `0` would truncate the static assertion list to nothing downstream.
        });
      }
    }
    await this.persistRuntime(testResults);
  }

  /**
   * Vitest 2.x equivalent of `onTestRunEnd`. 2.1.x dispatches this and never
   * calls `onTestRunEnd`; Vitest 4 does the opposite for custom reporters (it
   * still has an `onFinished` websocket event for the UI, which is not this).
   * Coverage has not been written yet — same as `onTestRunEnd` — so the snapshot
   * still happens in `onFinishedReportCoverage`, which 2.1.x already duck-types.
   */
  async onFinished(files: readonly Vitest2Task[] = []): Promise<void> {
    await this.persistRuntime(collectVitest2Results(files));
  }

  /**
   * Shared by both hooks so a Vitest 2 run and a Vitest 3+ run write the same
   * artifact. The coverage snapshot is deliberately not taken here — see
   * onFinishedReportCoverage for why this moment is always too early. Any snapshot
   * still on disk therefore belongs to an earlier run, and must not outlive the
   * runtime.json just overwritten: Vitest skips the coverage hook entirely when
   * tests fail and reportOnFailure is off, having already cleaned the coverage
   * directory, so a surviving copy becomes the only source the loader can find —
   * and it is loaded as current, because this run recorded a real provider and
   * nothing marks it stale.
   */
  private async persistRuntime(testResults: RuntimeTestResult[]): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(this.outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const data: RuntimeData = {
      framework: 'vitest',
      coverageProvider: this.coverageProvider,
      coverageDirectory: path.resolve(this.coverageDirectory),
      timestamp: new Date().toISOString(),
      testResults,
    };

    fs.writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify(data, null, 2));

    if (this.coverageProvider !== 'none') {
      try {
        fs.rmSync(path.join(dir, 'istanbul-coverage.json'), { force: true });
      } catch {
        // Best-effort cleanup of a best-effort artifact; must not fail an otherwise
        // green run over a lost convenience, matching onFinishedReportCoverage below.
      }
    }
  }

  /**
   * Copies the runner's `coverage-final.json` into the output directory.
   *
   * Not part of Vitest's published `Reporter` interface: core dispatches it duck-typed
   * (`'onFinishedReportCoverage' in reporter`) across every registered reporter from
   * `Vitest.reportCoverage()`, immediately after the coverage provider has finished
   * writing its reports. That is the first moment the file exists for the run just
   * observed — `onTestRunEnd` fires from `_testRun.end()` one line earlier, and the
   * provider wipes the coverage directory before the first test, so a copy attempted
   * there finds either nothing at all or, with `coverage.clean: false`, the *previous*
   * run's data stamped with a fresh mtime — which is precisely the signal
   * resolver/istanbul-source.ts uses to pick between this copy and the live file.
   *
   * Vitest skips this hook entirely when the run had failures and `reportOnFailure` is
   * off — `reportCoverage` returns before dispatching it, right after the provider has
   * already cleaned the coverage directory. No report is written for such a run, and
   * `onTestRunEnd` drops any earlier snapshot precisely so that none is left to be
   * mistaken for this one. Likewise if a future Vitest drops the hook: the copy simply
   * stops happening and the CLI goes on reading the live coverage directory recorded
   * in runtime.json.
   */
  async onFinishedReportCoverage(): Promise<void> {
    // The gate has to be re-applied here rather than inherited from onInit's
    // `enabled` check: a *custom* provider maps to 'none' but still reaches this hook,
    // since Vitest calls it whenever any provider is configured. Copying then would
    // present coverage this run never recorded in a form the CLI reads as current.
    if (this.coverageProvider === 'none') return;

    const fs = await import('fs');
    const path = await import('path');

    const istanbulSource = path.resolve(this.coverageDirectory, 'coverage-final.json');
    // Absent whenever the configured coverage reporters omit 'json'.
    if (!fs.existsSync(istanbulSource)) return;

    const dir = path.resolve(this.outputDir);
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(istanbulSource, path.join(dir, 'istanbul-coverage.json'));
    } catch {
      // The snapshot is an optimisation, never a source of truth — the CLI falls back
      // to the live coverage directory. Throwing would propagate out of Vitest's
      // reportCoverage() and fail an otherwise green run over a lost convenience.
    }
  }
}

/**
 * Walks Vitest 2's File → suite → test tree into the same rows `onTestRunEnd`
 * writes. An empty result is valid: a file whose tests were collected but never
 * finished (no result, or `run`/`only`) must not invent skips, and a run with
 * no tests still needs a current `runtime.json`.
 */
function collectVitest2Results(files: readonly Vitest2Task[]): RuntimeTestResult[] {
  const testResults: RuntimeTestResult[] = [];

  const walk = (task: Vitest2Task, ancestors: string[], filePath: string): void => {
    if (task.type === 'suite') {
      for (const child of task.tasks ?? []) {
        walk(child, [...ancestors, task.name ?? ''], filePath);
      }
      return;
    }
    const state = task.result?.state;
    // No result means collected but never run — not a skip.
    if (!state || state === 'run' || state === 'only') return;
    const status = VITEST_2_STATUS[state];
    if (!status) return;
    testResults.push({
      testFilePath: filePath,
      testName: [...ancestors, task.name].filter(Boolean).join(' > '),
      status,
      duration: task.result?.duration ?? 0,
    });
  };

  for (const file of files) {
    for (const task of file.tasks ?? []) {
      walk(task, [], file.filepath ?? file.name ?? '');
    }
  }
  return testResults;
}
