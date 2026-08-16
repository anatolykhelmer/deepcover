import type { CodeModel, TestNode } from '../types/code-model';
import { resolveTestClassFile, type ClassFileOwners } from '../types/method-owner';

/**
 * Identifies the callable a detector is currently inspecting. Standalone
 * functions are keyed by their module's file path, the way the resolver and
 * scorer key them.
 */
export interface CallableScope {
  /** Class name for a method; the declaring module's file path for a function. */
  owner: string;
  /** File declaring the callable. */
  filePath: string;
  isClass: boolean;
}

/**
 * Tests targeting one specific callable — the single scoping rule every bug
 * detector uses.
 *
 * Matching by bare `targetMethod` is what task 021 fixed everywhere else: a test
 * for `OrderService.save` must not count as evidence about `UserService.save`,
 * nor about a second `OrderService` declared in another file. Class methods
 * therefore fail closed — a test whose owning class (or, on duplicate class
 * names, whose declaring file) cannot be established is dropped rather than
 * credited. Standalone functions carry no per-test class signal, so they match
 * on method name alone.
 */
export function findTestsForCallable(
  codeModel: CodeModel,
  name: string,
  scope: CallableScope,
  classFileOwners: ClassFileOwners,
): TestNode[] {
  const tests: TestNode[] = [];
  for (const file of codeModel.testInventory.testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        if (test.targetMethod !== name) continue;
        if (scope.isClass) {
          if (test.targetClass !== scope.owner) continue;
          if (
            resolveTestClassFile(test.targetClass, test.targetClassFile ?? null, classFileOwners) !==
            scope.filePath
          ) continue;
        }
        tests.push(test);
      }
    }
  }
  return tests;
}
