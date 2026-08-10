import { Project, SyntaxKind } from 'ts-morph';
import { analyzeMethods } from '../method-analyzer';
import { analyzeFunctions } from '../function-analyzer';
import type { BranchNode } from '../../types/code-model';

function analyzeClassSource(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('subject.ts', source);
  const cls = sourceFile.getClasses()[0];
  return analyzeMethods(cls, new Map());
}

function branchesOf(source: string, methodName = 'run'): BranchNode[] {
  const method = analyzeClassSource(source).find((m) => m.name === methodName);
  if (!method) throw new Error(`method ${methodName} not found`);
  return method.branches;
}

function operandTexts(branch: BranchNode): string[] {
  return (branch.operands ?? []).map((o) => o.text);
}

describe('branch-analyzer — compound conditions', () => {
  it('splits an || chain into its operands, left to right', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: string, b: string) {
          if (a === undefined || b === undefined || a === '') {
            throw new Error('bad');
          }
        }
      }
    `);

    expect(branch.operator).toBe('||');
    expect(operandTexts(branch)).toEqual(["a === undefined", "b === undefined", "a === ''"]);
  });

  it('splits an && chain', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: number, b: number) {
          if (a > 0 && b > 0) {
            return a + b;
          }
          return 0;
        }
      }
    `);

    expect(branch.operator).toBe('&&');
    expect(operandTexts(branch)).toEqual(['a > 0', 'b > 0']);
  });

  it('leaves a simple condition with no operands at all', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: number) {
          if (a > 0) { return a; }
          return 0;
        }
      }
    `);

    expect(branch.operands).toBeUndefined();
    expect(branch.operator).toBeUndefined();
  });

  it('does not split ?? — it selects a value rather than deciding a branch', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: string | null, b: string) {
          if ((a ?? b).length > 0) { return a; }
          return b;
        }
      }
    `);

    expect(branch.operands).toBeUndefined();
  });

  it('sees through parentheses when they wrap the same operator', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: boolean, b: boolean, c: boolean) {
          if ((a || b) || c) { throw new Error('bad'); }
        }
      }
    `);

    expect(operandTexts(branch)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a nested chain of the other operator as one operand, as Istanbul does', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: boolean, b: boolean, c: boolean) {
          if (a || (b && c)) { throw new Error('bad'); }
        }
      }
    `);

    expect(branch.operator).toBe('||');
    expect(operandTexts(branch)).toEqual(['a', 'b && c']);
  });

  it('splits a ternary condition too', () => {
    const branches = branchesOf(`
      class S {
        run(a: string, b: string) {
          return a === '' || b === '' ? 'empty' : 'full';
        }
      }
    `);
    const ternary = branches.find((b) => b.type === 'ternary');

    expect(operandTexts(ternary!)).toEqual(["a === ''", "b === ''"]);
  });
});

describe('branch-analyzer — param references', () => {
  it('resolves an operand written against a local back to the param it derives from', () => {
    const [branch] = branchesOf(`
      class S {
        run(aRaw: string, bRaw: string) {
          const a = Number(aRaw);
          const b = Number(bRaw);
          if (aRaw === undefined || bRaw === undefined || Number.isNaN(a) || Number.isNaN(b)) {
            throw new Error('bad');
          }
          return a + b;
        }
      }
    `);

    expect(branch.operands?.map((o) => o.paramRefs)).toEqual([
      ['aRaw'],
      ['bRaw'],
      ['aRaw'],
      ['bRaw'],
    ]);
  });

  it('follows a chain of locals back to the params', () => {
    const [branch] = branchesOf(`
      class S {
        run(raw: string, other: string) {
          const parsed = Number(raw);
          const doubled = parsed * 2;
          if (doubled > 10 || other === '') { throw new Error('bad'); }
        }
      }
    `);

    expect(branch.operands?.map((o) => o.paramRefs)).toEqual([['raw'], ['other']]);
  });

  it('records every param an operand reads', () => {
    const [branch] = branchesOf(`
      class S {
        run(a: number, b: number, c: number) {
          if (a > b || c < 0) { throw new Error('bad'); }
        }
      }
    `);

    expect(branch.operands?.[0].paramRefs.sort()).toEqual(['a', 'b']);
  });

  it('does not mistake a property name for a param reference', () => {
    const [branch] = branchesOf(`
      class S {
        run(isNaN: number, other: number) {
          if (Number.isNaN(other) || other < 0) { throw new Error('bad'); }
        }
      }
    `);

    // `Number.isNaN` must not resolve to the param that happens to be called `isNaN`.
    expect(branch.operands?.[0].paramRefs).toEqual(['other']);
  });

  it('leaves paramRefs empty for an operand that reads no param', () => {
    const [branch] = branchesOf(`
      class S {
        private ready = false;
        run(a: number) {
          if (!this.ready || a < 0) { throw new Error('bad'); }
        }
      }
    `);

    expect(branch.operands?.[0].paramRefs).toEqual([]);
    expect(branch.operands?.[1].paramRefs).toEqual(['a']);
  });
});

describe('branch-analyzer — guard exits', () => {
  it('records how a guard leaves the method', () => {
    const branches = branchesOf(`
      class S {
        run(a: number, b: number) {
          if (a < 0 || b < 0) { throw new Error('bad'); }
          if (a === 0 || b === 0) return 0;
          if (a > b) { console.log('bigger'); }
          return a + b;
        }
      }
    `);

    expect(branches.map((b) => [b.type, b.guardExit])).toEqual([
      ['guard', 'throw'],
      ['guard', 'return'],
      ['if', undefined],
    ]);
  });
});

describe('branch-analyzer — standalone functions', () => {
  it('decomposes conditions in exported functions the same way', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('fns.ts', `
      export function validate(name: string, email: string): boolean {
        if (name === '' || email === '') {
          throw new Error('bad');
        }
        return true;
      }
    `);

    const [fn] = analyzeFunctions(sourceFile);

    expect(fn.branches[0].operator).toBe('||');
    expect(fn.branches[0].operands?.map((o) => o.text)).toEqual(["name === ''", "email === ''"]);
    expect(fn.branches[0].operands?.map((o) => o.paramRefs)).toEqual([['name'], ['email']]);
  });
});

describe('branch-analyzer — branchCount', () => {
  it('counts branch points, not operands', () => {
    const method = analyzeClassSource(`
      class S {
        run(a: number, b: number) {
          if (a < 0 || b < 0 || a > 100) { throw new Error('bad'); }
          return a + b;
        }
      }
    `)[0];

    // Counting operands here would silently reweight complexity for every project.
    expect(method.branchCount).toBe(1);
    expect(method.branches[0].operands).toHaveLength(3);
  });
});

describe('branch-analyzer — operand line alignment with Istanbul', () => {
  it('reports the branch line an Istanbul binary-expr is keyed by', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('subject.ts', `class S {
  run(a: number, b: number) {
    if (a < 0 || b < 0) {
      throw new Error('bad');
    }
  }
}`);
    const [method] = analyzeMethods(sourceFile.getClasses()[0], new Map());
    const ifStatement = sourceFile.getFirstDescendantByKind(SyntaxKind.IfStatement);

    expect(method.branches[0].lineNumber).toBe(ifStatement!.getStartLineNumber());
    expect(method.branches[0].lineNumber).toBe(3);
  });
});
