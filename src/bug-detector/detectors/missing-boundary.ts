import type { CodeModel } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';

const BOUNDARY_PATTERN = /(\w+)\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const LENGTH_PATTERN = /(\w+)\.length\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const BOUNDARY_TEST_KEYWORDS = ['zero', 'negative', 'boundary', 'edge', 'limit', 'max', 'min', 'empty', 'overflow', 'underflow'];

export class MissingBoundaryDetector implements BugDetector {
  readonly pattern = 'missing-boundary' as const;

  detect(codeModel: CodeModel, _coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          const boundaryBranches = method.branches.filter((b) => BOUNDARY_PATTERN.test(b.condition) || LENGTH_PATTERN.test(b.condition));
          if (boundaryBranches.length === 0) continue;

          const tests = this.findTestsForMethod(codeModel, method.name);
          const hasBoundaryTest = tests.some((t) => BOUNDARY_TEST_KEYWORDS.some((kw) => t.name.toLowerCase().includes(kw)));

          if (!hasBoundaryTest) {
            for (const branch of boundaryBranches) {
              const match = branch.condition.match(BOUNDARY_PATTERN) || branch.condition.match(LENGTH_PATTERN);
              if (!match) continue;
              signals.push({
                pattern: this.pattern, className: cls.name, methodName: method.name,
                evidence: `Condition "${match[1]} ${match[2]} ${match[3]}" at line ${branch.lineNumber} — no test checks boundary value`,
                sourceLocation: { file: mod.filePath, line: branch.lineNumber },
                confidence: 0.4,
              });
            }
          }
        }
      }
    }
    return signals;
  }

  private findTestsForMethod(codeModel: CodeModel, methodName: string) {
    const tests: Array<{ name: string }> = [];
    for (const file of codeModel.testInventory.testFiles) {
      for (const block of file.describes) {
        for (const test of block.tests) {
          if (test.targetMethod === methodName) tests.push(test);
        }
      }
    }
    return tests;
  }
}
