import path from 'path';
import type { ClassNode, CodeModel, ModuleNode, TestFileNode } from '../types/code-model';

/**
 * The extractor always globs every spec file in the project, regardless of the
 * `include` patterns used for source files. Commands that operate on a single
 * module must therefore narrow the test inventory themselves before feeding it
 * to prompts — otherwise the Reasoner sees the whole repository's tests.
 */

export function collectSourceMethodNames(modules: ModuleNode[]): Set<string> {
  const names = new Set<string>();

  for (const mod of modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        names.add(method.name);
      }
    }
    for (const fn of mod.functions ?? []) {
      names.add(fn.name);
    }
  }

  return names;
}

export function filterTestFilesByModule(
  testFiles: TestFileNode[],
  modulePath: string | undefined,
  sourceMethodNames: Set<string>,
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
  sourceMethodNames: Set<string>,
): TestFileNode[] {
  if (modules.length === 0) return testFiles;
  const sourceDirs = new Set(modules.map((m) => path.dirname(m.filePath)));

  return testFiles.filter((tf) => {
    if (sourceDirs.has(path.dirname(tf.filePath))) return true;
    return testsTargetKnownMethod(tf, sourceMethodNames);
  });
}

function testsTargetKnownMethod(
  testFile: TestFileNode,
  sourceMethodNames: Set<string>,
): boolean {
  return testFile.describes.some((d) =>
    d.tests.some((t) => t.targetMethod && sourceMethodNames.has(t.targetMethod)),
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
