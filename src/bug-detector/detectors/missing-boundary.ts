import type { CodeModel, CallableNode } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners, type ClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable, type CallableScope } from '../find-tests';
import { allCallables } from '../../types/callable';

const BOUNDARY_PATTERN = /(\w+)\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const LENGTH_PATTERN = /(\w+)\.length\s*(>|<|>=|<=|===|!==)\s*(\d+)/;
const BOUNDARY_TEST_KEYWORDS = ['zero', 'negative', 'boundary', 'edge', 'limit', 'max', 'min', 'empty', 'overflow', 'underflow'];

export class MissingBoundaryDetector implements BugDetector {
  readonly pattern = 'missing-boundary' as const;

  detect(codeModel: CodeModel, _coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    const classFileOwners = buildClassFileOwners(codeModel.modules);

    for (const mod of codeModel.modules) {
      for (const c of allCallables(mod)) {
        signals.push(...this.inspect(codeModel, c.node,
          { owner: c.owner, filePath: c.filePath, isClass: c.ownerKind === 'class' }, classFileOwners));
      }
    }
    return signals;
  }

  private inspect(
    codeModel: CodeModel,
    callable: CallableNode,
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
