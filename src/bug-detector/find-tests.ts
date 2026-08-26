import type { CodeModel, TestNode } from '../types/code-model';
import type { ClassFileOwners } from '../types/method-owner';
import { allTests, testInScopeOf, type TestScope } from '../types/test-inventory';

/**
 * Tests targeting one specific callable — the single scoping rule every bug
 * detector uses. The rule itself lives in `testInScopeOf`; see its doc comment
 * for why class methods fail closed and standalone functions do not scope.
 */
export function findTestsForCallable(
  codeModel: CodeModel,
  name: string,
  scope: TestScope,
  classFileOwners: ClassFileOwners,
): TestNode[] {
  const tests: TestNode[] = [];
  for (const test of allTests(codeModel.testInventory.testFiles)) {
    if (test.targetMethod !== name) continue;
    if (!testInScopeOf(test, scope, classFileOwners)) continue;
    tests.push(test);
  }
  return tests;
}
