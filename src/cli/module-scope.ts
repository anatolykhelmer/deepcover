import path from 'path';
import type { ClassNode, CodeModel, ModuleNode, TestFileNode } from '../types/code-model';
import { buildClassMethodOwners, type ClassMethodOwners } from '../types/method-owner';

/**
 * The extractor always globs every spec file in the project, regardless of the
 * `include` patterns used for source files. Commands that operate on a single
 * module must therefore narrow the test inventory themselves before feeding it
 * to prompts — otherwise the Reasoner sees the whole repository's tests.
 */

export interface SourceMethodNames {
  classMethodOwners: ClassMethodOwners;
  functionNames: Set<string>;
}

export function collectSourceMethodNames(modules: ModuleNode[]): SourceMethodNames {
  const classMethodOwners = buildClassMethodOwners(modules);
  const functionNames = new Set<string>();

  for (const mod of modules) {
    for (const fn of mod.functions ?? []) {
      functionNames.add(fn.name);
    }
  }

  return { classMethodOwners, functionNames };
}

export function filterTestFilesByModule(
  testFiles: TestFileNode[],
  modulePath: string | undefined,
  sourceMethodNames: SourceMethodNames,
): TestFileNode[] {
  if (!modulePath) return testFiles;
  const moduleBasename = path.basename(modulePath.replace(/\/$/, ''));

  return testFiles.filter((tf) => {
    if (tf.filePath.includes(moduleBasename)) return true;
    return testsTargetKnownMethod(tf, sourceMethodNames);
  });
}

/**
 * Scope test files when no `--module` flag is available (e.g. a CodeModel
 * loaded from disk): the model's own source files define the scope.
 */
export function scopeTestFilesToModel(
  testFiles: TestFileNode[],
  modules: ModuleNode[],
  sourceMethodNames: SourceMethodNames,
): TestFileNode[] {
  if (modules.length === 0) return testFiles;
  const sourceDirs = new Set(modules.map((m) => path.dirname(m.filePath)));

  return testFiles.filter((tf) => {
    if (sourceDirs.has(path.dirname(tf.filePath))) return true;
    return testsTargetKnownMethod(tf, sourceMethodNames);
  });
}

/**
 * Whether a test targets a method this module's scope actually owns.
 *
 * A module scoped via `--module` only ever sees its own classes — a same-named
 * class method elsewhere in the repo (invisible here) must not let that test back
 * in just because the bare name matches. Class-owned methods therefore require a
 * validated class match: `t.targetClass` must be resolved AND equal one of the
 * method's real owners, failing closed otherwise. Standalone functions have no
 * comparable per-test class signal (no `new X()`/`describe('ClassName', …)`
 * construct ties a test to a specific module), so they keep the previous
 * bare-name match — a narrower, documented, pre-existing limitation.
 */
function testsTargetKnownMethod(
  testFile: TestFileNode,
  sourceMethodNames: SourceMethodNames,
): boolean {
  const { classMethodOwners, functionNames } = sourceMethodNames;

  return testFile.describes.some((d) =>
    d.tests.some((t) => {
      if (!t.targetMethod) return false;
      const owners = classMethodOwners.get(t.targetMethod);
      if (owners && owners.size > 0) {
        const targetClass = t.targetClass ?? null;
        return !!targetClass && owners.has(targetClass);
      }
      return functionNames.has(t.targetMethod);
    }),
  );
}

const STRUCTURAL_CLASS_TYPES = new Set(['controller', 'service', 'gateway', 'module']);

export function filterClassesForPrompts(classes: ClassNode[]): ClassNode[] {
  return classes.filter(
    (cls) => cls.methods.length > 0 || STRUCTURAL_CLASS_TYPES.has(cls.type),
  );
}

/**
 * Narrow a CodeModel to what the Reasoner should actually see: tests belonging
 * to the module under analysis, and classes worth putting in a prompt. This
 * mirrors what the `extract` command feeds into prompts.json, so both entry
 * points reason over the same material.
 */
export function scopeModelForReasoner(codeModel: CodeModel, modulePath?: string): CodeModel {
  const sourceMethodNames = collectSourceMethodNames(codeModel.modules);
  const testFiles = modulePath
    ? filterTestFilesByModule(codeModel.testInventory.testFiles, modulePath, sourceMethodNames)
    : scopeTestFilesToModel(codeModel.testInventory.testFiles, codeModel.modules, sourceMethodNames);

  return {
    ...codeModel,
    modules: codeModel.modules.map((m) => ({
      ...m,
      classes: filterClassesForPrompts(m.classes),
    })),
    testInventory: { ...codeModel.testInventory, testFiles },
  };
}
