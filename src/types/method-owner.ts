import type { ModuleNode } from './code-model';

/**
 * Maps a class method's bare name to every class in scope that declares it,
 * and each owning class name to the files that declare a class by that name.
 * Two files may both export `class OrderService`, so a class name alone does
 * not identify a declaration — the file set does.
 */
export type ClassMethodOwners = Map<string, Map<string, Set<string>>>;

/**
 * Built once per `CodeModel` (or per-extraction module list) and consulted anywhere a
 * test needs to be matched to the specific class it targets — never by method name
 * alone, since an unrelated class can define a method with the same name.
 */
export function buildClassMethodOwners(modules: ModuleNode[]): ClassMethodOwners {
  const owners: ClassMethodOwners = new Map();
  for (const mod of modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        let byClass = owners.get(method.name);
        if (!byClass) {
          byClass = new Map();
          owners.set(method.name, byClass);
        }
        let files = byClass.get(cls.name);
        if (!files) {
          files = new Set();
          byClass.set(cls.name, files);
        }
        files.add(mod.filePath);
      }
    }
  }
  return owners;
}

/** Internal coverage key for a class method, file-qualified so same-named
 *  classes in different files never collide (task 021). Human-facing output
 *  keeps `ClassName.methodName`. */
export function classMethodKey(filePath: string, className: string, methodName: string): string {
  return `${filePath}:${className}.${methodName}`;
}

/**
 * Resolves the file-qualified coverage key a test's credit should attach to.
 * Fails closed (`null`) whenever the owning class — or, for a class name
 * declared in several files, the specific file — cannot be established:
 * misattributed credit is worse than dropped credit.
 *
 * @param targetClassFile The declaration file of the class the test imports,
 *   when the extractor could resolve it; used only to break duplicate-name ties.
 */
export function resolveClassMethodKey(
  targetMethod: string,
  targetClass: string | null | undefined,
  targetClassFile: string | null | undefined,
  owners: ClassMethodOwners
): string | null {
  const byClass = owners.get(targetMethod);
  if (!byClass || byClass.size === 0) return null;
  if (!targetClass) return null;

  const files = byClass.get(targetClass);
  if (!files || files.size === 0) return null;
  if (files.size === 1) {
    return classMethodKey(files.values().next().value as string, targetClass, targetMethod);
  }
  if (targetClassFile && files.has(targetClassFile)) {
    return classMethodKey(targetClassFile, targetClass, targetMethod);
  }
  return null;
}
