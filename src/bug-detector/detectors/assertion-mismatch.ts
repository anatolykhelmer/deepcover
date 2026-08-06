import type { CodeModel } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';

const VOID_RETURN_TYPES = new Set(['void', 'Promise<void>', 'never']);
const VALUE_ASSERTION_TYPES = new Set(['value_check', 'throws', 'rejects', 'snapshot']);

export class AssertionMismatchDetector implements BugDetector {
  readonly pattern = 'assertion-mismatch' as const;

  detect(codeModel: CodeModel, _coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          if (VOID_RETURN_TYPES.has(method.returnType)) continue;
          const tests = this.findTestsForMethod(codeModel, method.name);
          if (tests.length === 0) continue;
          const anyTestChecksReturnValue = tests.some((t) => t.assertions.some((a) => VALUE_ASSERTION_TYPES.has(a.type)));
          if (!anyTestChecksReturnValue) {
            const hasMockAssertionsOnly = tests.every((t) =>
              t.assertions.length > 0 && t.assertions.every((a) => a.type === 'called_with' || a.type === 'spy_call_count'),
            );
            if (hasMockAssertionsOnly) {
              signals.push({
                pattern: this.pattern, className: cls.name, methodName: method.name,
                evidence: `Method returns ${method.returnType} but ${tests.length} test(s) only assert on mock calls, never checking the return value`,
                sourceLocation: { file: mod.filePath, line: method.startLine },
                confidence: method.externalCalls.length > 0 ? 0.7 : 0.8,
              });
            }
          }
        }
      }
    }
    return signals;
  }

  private findTestsForMethod(codeModel: CodeModel, methodName: string) {
    const tests: Array<{ assertions: Array<{ type: string; target: string }> }> = [];
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
