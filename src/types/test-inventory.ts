import type { TestNode, TestFileNode } from './code-model';
import { resolveTestClassFile, type ClassFileOwners } from './method-owner';

/** Every test in one test file, across all its describe blocks, in source order. */
export function* testsInFile(file: TestFileNode): Generator<TestNode> {
  for (const block of file.describes) {
    for (const test of block.tests) {
      yield test;
    }
  }
}

/**
 * Every test in a test-file list. Takes the array rather than a `TestInventory`
 * because it never reads `inventory.coverage`, and several callers hold only
 * the array.
 */
export function* allTests(testFiles: TestFileNode[]): Generator<TestNode> {
  for (const file of testFiles) {
    yield* testsInFile(file);
  }
}

/**
 * Identifies the callable a test is being matched against. Structurally
 * satisfied by `Callable` (`types/callable.ts`), so callers holding one pass it
 * straight through rather than re-projecting three fields.
 */
export interface TestScope {
  /** Class name for a method; the declaring module's file path for a function. */
  owner: string;
  /** File declaring the callable. */
  filePath: string;
  ownerKind: 'class' | 'module';
}

/**
 * The task-021 scoping rule, in one place.
 *
 * A test may be credited to a class method only when its resolved `targetClass`
 * equals the method's owner AND that class resolves to the method's own file.
 * Without both halves a test for `OrderService.save` counts as evidence about
 * `UserService.save`, or about a second `OrderService` declared elsewhere.
 * Unresolvable ownership fails closed — misattributed credit is worse than
 * dropped credit.
 *
 * Module-owned callables (standalone functions) have no comparable per-test
 * class signal, so the gate admits everything for them. That is a narrower,
 * documented, pre-existing limitation, and this is the only place it lives.
 *
 * The check below matches positively on `'module'` rather than negatively on
 * `'class'`, so it fails closed by construction. `ownerKind` is a growable
 * union; `'module'` is the one enumerated exception to the class-scoping rule,
 * and everything else — including a kind added later, such as a `'namespace'`
 * on `Callable` — falls through to the class branch and is gated, rather than
 * silently admitted the way a `!== 'class'` check would admit it.
 */
export function testInScopeOf(
  test: TestNode,
  scope: TestScope,
  classFileOwners: ClassFileOwners,
): boolean {
  if (scope.ownerKind === 'module') return true;
  if (test.targetClass !== scope.owner) return false;
  return (
    resolveTestClassFile(test.targetClass, test.targetClassFile ?? null, classFileOwners) ===
    scope.filePath
  );
}
