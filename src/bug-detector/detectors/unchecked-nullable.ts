import type { CodeModel, CallableNode } from '../../types/code-model';
import type { ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners, type ClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable, type CallableScope } from '../find-tests';
import { allCallables } from '../../types/callable';

const NULLABLE_TYPE_PATTERNS = [/\|\s*null\b/, /\|\s*undefined\b/, /\bnull\s*\|/, /\bundefined\s*\|/];
const NULL_TEST_KEYWORDS = ['null', 'undefined', 'missing', 'empty', 'without', 'no '];

export class UncheckedNullableDetector implements BugDetector {
  readonly pattern = 'unchecked-nullable' as const;

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
    const nullableParams = callable.params.filter((p) => p.isOptional || this.isNullableType(p.type));
    if (nullableParams.length === 0) return [];

    const tests = findTestsForCallable(codeModel, callable.name, scope, classFileOwners);
    const hasNullTest = tests.some((t) =>
      NULL_TEST_KEYWORDS.some((kw) => t.name.toLowerCase().includes(kw)),
    );
    if (hasNullTest) return [];

    const hasNullCheck = callable.branches.some(
      (b) => b.condition.includes('null') || b.condition.includes('undefined'),
    );
    return nullableParams.map((param) => ({
      pattern: this.pattern,
      className: scope.owner,
      methodName: callable.name,
      evidence: `Parameter "${param.name}" (${param.isOptional ? 'optional' : param.type}) has no test passing null/undefined`,
      sourceLocation: { file: scope.filePath, line: callable.startLine },
      confidence: hasNullCheck ? 0.8 : 0.5,
    }));
  }

  private isNullableType(type: string): boolean {
    return NULLABLE_TYPE_PATTERNS.some((p) => p.test(type));
  }
}
