import type { CodeModel, MethodNode, FunctionNode } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners, type ClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable, type CallableScope } from '../find-tests';

const VOID_RETURN_TYPES = new Set(['void', 'Promise<void>', 'never']);
const VALUE_ASSERTION_TYPES = new Set(['value_check', 'throws', 'rejects', 'snapshot']);
const MOCK_ASSERTION_TYPES = new Set(['called_with', 'spy_call_count']);

export class AssertionMismatchDetector implements BugDetector {
  readonly pattern = 'assertion-mismatch' as const;

  detect(codeModel: CodeModel, _coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    const classFileOwners = buildClassFileOwners(codeModel.modules);

    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          signals.push(...this.inspect(codeModel, method,
            { owner: cls.name, filePath: mod.filePath, isClass: true }, classFileOwners));
        }
      }
      for (const fn of mod.functions ?? []) {
        signals.push(...this.inspect(codeModel, fn,
          { owner: mod.filePath, filePath: mod.filePath, isClass: false }, classFileOwners));
      }
    }
    return signals;
  }

  private inspect(
    codeModel: CodeModel,
    callable: MethodNode | FunctionNode,
    scope: CallableScope,
    classFileOwners: ClassFileOwners
  ): BugSignal[] {
    if (VOID_RETURN_TYPES.has(callable.returnType)) return [];

    const tests = findTestsForCallable(codeModel, callable.name, scope, classFileOwners);
    // An untested callable is a coverage gap the gap generator already reports;
    // this detector only judges the assertions tests do make.
    if (tests.length === 0) return [];

    if (tests.some((t) => t.assertions.some((a) => VALUE_ASSERTION_TYPES.has(a.type)))) return [];

    const hasMockAssertionsOnly = tests.every(
      (t) => t.assertions.length > 0 && t.assertions.every((a) => MOCK_ASSERTION_TYPES.has(a.type)),
    );
    if (!hasMockAssertionsOnly) return [];

    return [{
      pattern: this.pattern,
      className: scope.owner,
      methodName: callable.name,
      evidence: `Method returns ${callable.returnType} but ${tests.length} test(s) only assert on mock calls, never checking the return value`,
      sourceLocation: { file: scope.filePath, line: callable.startLine },
      confidence: callable.externalCalls.length > 0 ? 0.7 : 0.8,
    }];
  }
}
