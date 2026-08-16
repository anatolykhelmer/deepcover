import type { CodeModel, MethodNode, FunctionNode } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners, type ClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable, type CallableScope } from '../find-tests';

const BOUNDARY_PATTERN = /(\w+)\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const LENGTH_PATTERN = /(\w+)\.length\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const BOUNDARY_TEST_KEYWORDS = ['zero', 'negative', 'boundary', 'edge', 'limit', 'max', 'min', 'empty', 'overflow', 'underflow'];

export class MissingBoundaryDetector implements BugDetector {
  readonly pattern = 'missing-boundary' as const;

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
    const boundaryBranches = callable.branches.filter(
      (b) => BOUNDARY_PATTERN.test(b.condition) || LENGTH_PATTERN.test(b.condition),
    );
    if (boundaryBranches.length === 0) return [];

    const tests = findTestsForCallable(codeModel, callable.name, scope, classFileOwners);
    const hasBoundaryTest = tests.some((t) =>
      BOUNDARY_TEST_KEYWORDS.some((kw) => t.name.toLowerCase().includes(kw)),
    );
    if (hasBoundaryTest) return [];

    const signals: BugSignal[] = [];
    for (const branch of boundaryBranches) {
      const match = branch.condition.match(BOUNDARY_PATTERN) || branch.condition.match(LENGTH_PATTERN);
      if (!match) continue;
      signals.push({
        pattern: this.pattern,
        className: scope.owner,
        methodName: callable.name,
        evidence: `Condition "${match[1]} ${match[2]} ${match[3]}" at line ${branch.lineNumber} — no test checks boundary value`,
        sourceLocation: { file: scope.filePath, line: branch.lineNumber },
        confidence: 0.4,
      });
    }
    return signals;
  }
}
