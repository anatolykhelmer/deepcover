import type { CodeModel } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable } from '../find-tests';

const ERROR_TEST_KEYWORDS = [
  'error', 'fail', 'throw', 'reject', 'exception', 'invalid',
  'not found', 'unauthorized', 'forbidden', 'timeout',
];
const ERROR_ASSERTION_TYPES = new Set(['throws', 'rejects']);

export class UnhandledErrorPathDetector implements BugDetector {
  readonly pattern = 'unhandled-error-path' as const;

  detect(codeModel: CodeModel, coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    const classFileOwners = buildClassFileOwners(codeModel.modules);
    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          const catchBranches = method.branches.filter((b) => b.type === 'try_catch');
          if (catchBranches.length === 0 && !method.throwsErrors) continue;

          const tests = findTestsForCallable(codeModel, method.name,
            { owner: cls.name, filePath: mod.filePath, isClass: true }, classFileOwners);
          const hasErrorTest = tests.some((t) => this.isErrorPathTest(t));

          if (!hasErrorTest) {
            signals.push({
              pattern: this.pattern,
              className: cls.name,
              methodName: method.name,
              evidence: catchBranches.length > 0
                ? `${catchBranches.length} catch block(s) at line(s) ${catchBranches.map((b) => b.lineNumber).join(', ')} with no error-path test`
                : `Method throws errors but no test provokes the error path`,
              sourceLocation: { file: mod.filePath, line: catchBranches[0]?.lineNumber ?? method.startLine },
              confidence: this.calculateConfidence(catchBranches.length, method.throwsErrors, coverage, cls.name, method.name, mod.filePath),
            });
          }
        }
      }
    }
    return signals;
  }

  private isErrorPathTest(test: { name: string; assertions: Array<{ type: string }> }): boolean {
    if (ERROR_TEST_KEYWORDS.some((kw) => test.name.toLowerCase().includes(kw))) return true;
    if (test.assertions.some((a) => ERROR_ASSERTION_TYPES.has(a.type))) return true;
    return false;
  }

  private calculateConfidence(catchCount: number, throwsErrors: boolean, coverage: ResolvedCoverage, className: string, methodName: string, filePath: string): number {
    let confidence = 0.5;
    if (catchCount > 0) confidence += 0.1 * Math.min(catchCount, 3);
    if (throwsErrors) confidence += 0.1;
    const mc = coverage.getMethodCoverage(className, methodName, filePath);
    if (mc?.istanbul && mc.istanbul.branchCoveragePercent < 100) confidence += 0.1;
    return Math.min(confidence, 1);
  }
}
