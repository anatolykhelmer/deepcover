import type { ModuleNode } from './code-model';

/** Maps a class method's bare name to every class in scope that declares it. */
export type ClassMethodOwners = Map<string, Set<string>>;

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
        let set = owners.get(method.name);
        if (!set) {
          set = new Set();
          owners.set(method.name, set);
        }
        set.add(cls.name);
      }
    }
  }
  return owners;
}
