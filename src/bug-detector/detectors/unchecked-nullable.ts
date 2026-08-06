import type { CodeModel } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';

const NULLABLE_TYPE_PATTERNS = [/\|\s*null\b/, /\|\s*undefined\b/, /\bnull\s*\|/, /\bundefined\s*\|/];
const NULL_TEST_KEYWORDS = ['null', 'undefined', 'missing', 'empty', 'without', 'no '];

export class UncheckedNullableDetector implements BugDetector {
  readonly pattern = 'unchecked-nullable' as const;

  detect(codeModel: CodeModel, _coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          const nullableParams = method.params.filter((p) => p.isOptional || this.isNullableType(p.type));
          if (nullableParams.length === 0) continue;

          const tests = this.findTestsForMethod(codeModel, method.name);
          const hasNullTest = tests.some((t) => NULL_TEST_KEYWORDS.some((kw) => t.name.toLowerCase().includes(kw)));

          if (!hasNullTest) {
            const hasNullCheck = method.branches.some((b) => b.condition.includes('null') || b.condition.includes('undefined'));
            for (const param of nullableParams) {
              signals.push({
                pattern: this.pattern,
                className: cls.name,
                methodName: method.name,
                evidence: `Parameter "${param.name}" (${param.isOptional ? 'optional' : param.type}) has no test passing null/undefined`,
                sourceLocation: { file: mod.filePath, line: method.startLine },
                confidence: hasNullCheck ? 0.8 : 0.5,
              });
            }
          }
        }
      }
    }
    return signals;
  }

  private isNullableType(type: string): boolean {
    return NULLABLE_TYPE_PATTERNS.some((p) => p.test(type));
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
