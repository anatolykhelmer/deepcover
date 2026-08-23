import type { CallableNode, ModuleNode } from './code-model';

/**
 * Unified in-memory identity of a callable, built ONLY here. Class methods keep
 * the historical `filePath:Class.method`; standalone functions use
 * `filePath:fnName` (callable names cannot contain dots, so the two forms
 * cannot collide). NOT an artifact format — see `Callable.inventoryKey`.
 */
export type CoverageKey = string & { readonly __coverageKey: unique symbol };

export function methodCoverageKey(filePath: string, className: string, methodName: string): CoverageKey {
  return `${filePath}:${className}.${methodName}` as CoverageKey;
}

export function functionCoverageKey(filePath: string, fnName: string): CoverageKey {
  return `${filePath}:${fnName}` as CoverageKey;
}

/**
 * One kind-agnostic view over a method or standalone function. The
 * method/function dualism of the frozen artifact formats lives HERE and only
 * here: `inventoryKey` is the key into `TestInventory.coverage` and the jest
 * runtime map (file-qualified for methods, bare name for functions — frozen
 * contract), while `key` is the unified in-memory map identity.
 */
export interface Callable {
  node: CallableNode;
  ownerKind: 'class' | 'module';
  /** Class name, or the module filePath for standalone functions. */
  owner: string;
  filePath: string;
  key: CoverageKey;
  /** Human-facing: `Class.method` | `filePath.fnName` (unchanged formats). */
  qualifiedName: string;
  inventoryKey: string;
}

export function* allCallables(mod: ModuleNode): Generator<Callable> {
  for (const cls of mod.classes) {
    for (const method of cls.methods) {
      yield {
        node: method,
        ownerKind: 'class',
        owner: cls.name,
        filePath: mod.filePath,
        key: methodCoverageKey(mod.filePath, cls.name, method.name),
        qualifiedName: `${cls.name}.${method.name}`,
        inventoryKey: methodCoverageKey(mod.filePath, cls.name, method.name),
      };
    }
  }
  for (const fn of mod.functions ?? []) {
    yield {
      node: fn,
      ownerKind: 'module',
      owner: mod.filePath,
      filePath: mod.filePath,
      key: functionCoverageKey(mod.filePath, fn.name),
      qualifiedName: `${mod.filePath}.${fn.name}`,
      inventoryKey: fn.name,
    };
  }
}

/** Key of a same-owner callee: class scope for methods, module scope for functions. */
export function calleeKey(caller: Callable, calleeName: string): CoverageKey {
  return caller.ownerKind === 'class'
    ? methodCoverageKey(caller.filePath, caller.owner, calleeName)
    : functionCoverageKey(caller.filePath, calleeName);
}
