import type { TestNode, TestFileNode } from '../code-model';
import type { ClassFileOwners } from '../method-owner';
import { testsInFile, allTests, testInScopeOf, type TestScope } from '../test-inventory';

function makeTest(name: string, over: Partial<TestNode> = {}): TestNode {
  return { name, targetMethod: null, assertions: [], mocks: [], isAsync: false, ...over };
}

function makeFile(filePath: string, blocks: Array<[string, TestNode[]]>): TestFileNode {
  return { filePath, describes: blocks.map(([name, tests]) => ({ name, tests })) };
}

describe('testsInFile', () => {
  it('yields every test across every describe block, in source order', () => {
    const file = makeFile('a.spec.ts', [
      ['OrderService', [makeTest('creates'), makeTest('rejects')]],
      ['helpers', [makeTest('formats')]],
    ]);
    expect([...testsInFile(file)].map((t) => t.name)).toEqual(['creates', 'rejects', 'formats']);
  });

  it('yields nothing for a file with no describe blocks', () => {
    expect([...testsInFile(makeFile('a.spec.ts', []))]).toEqual([]);
  });

  it('yields nothing for a describe block with no tests', () => {
    expect([...testsInFile(makeFile('a.spec.ts', [['empty', []]]))]).toEqual([]);
  });
});

describe('allTests', () => {
  it('yields tests file by file, preserving order within each file', () => {
    const files = [
      makeFile('a.spec.ts', [['A', [makeTest('a1'), makeTest('a2')]]]),
      makeFile('b.spec.ts', [['B', [makeTest('b1')]]]),
    ];
    expect([...allTests(files)].map((t) => t.name)).toEqual(['a1', 'a2', 'b1']);
  });

  it('yields nothing for an empty file list', () => {
    expect([...allTests([])]).toEqual([]);
  });
});

describe('testInScopeOf', () => {
  const uniqueOwners: ClassFileOwners = new Map([['OrderService', new Set(['src/order.ts'])]]);
  const duplicateOwners: ClassFileOwners = new Map([
    ['OrderService', new Set(['src/order.ts', 'src/legacy/order.ts'])],
  ]);
  const classScope: TestScope = {
    owner: 'OrderService', filePath: 'src/order.ts', ownerKind: 'class',
  };

  it('accepts a test whose class resolves to this scope\'s own file', () => {
    const test = makeTest('creates', { targetClass: 'OrderService' });
    expect(testInScopeOf(test, classScope, uniqueOwners)).toBe(true);
  });

  it('rejects a test whose class is declared in a different file', () => {
    const test = makeTest('creates', { targetClass: 'OrderService' });
    const otherFile: TestScope = { ...classScope, filePath: 'src/other.ts' };
    expect(testInScopeOf(test, otherFile, uniqueOwners)).toBe(false);
  });

  it('rejects a test targeting a different class', () => {
    const test = makeTest('creates', { targetClass: 'UserService' });
    expect(testInScopeOf(test, classScope, uniqueOwners)).toBe(false);
  });

  it('fails closed when the test resolved no target class at all', () => {
    expect(testInScopeOf(makeTest('creates'), classScope, uniqueOwners)).toBe(false);
    expect(testInScopeOf(makeTest('creates', { targetClass: null }), classScope, uniqueOwners)).toBe(false);
  });

  it('uses the imported file to break a duplicate class name tie', () => {
    const test = makeTest('creates', {
      targetClass: 'OrderService', targetClassFile: 'src/order.ts',
    });
    expect(testInScopeOf(test, classScope, duplicateOwners)).toBe(true);
  });

  it('rejects a duplicate-named class imported from the other file', () => {
    const test = makeTest('creates', {
      targetClass: 'OrderService', targetClassFile: 'src/legacy/order.ts',
    });
    expect(testInScopeOf(test, classScope, duplicateOwners)).toBe(false);
  });

  it('fails closed on a duplicate class name with no import signal', () => {
    const test = makeTest('creates', { targetClass: 'OrderService', targetClassFile: null });
    expect(testInScopeOf(test, classScope, duplicateOwners)).toBe(false);
  });

  // Documented pre-existing limitation: a standalone function has no per-test
  // class signal (no `new X()` / `describe('ClassName')` construct ties a test
  // to one module), so the gate is a no-op for module-owned callables. This is
  // the single place that decision now lives.
  it('admits every test for a module-owned callable, scoping nothing', () => {
    const fnScope: TestScope = {
      owner: 'src/util.ts', filePath: 'src/util.ts', ownerKind: 'module',
    };
    expect(testInScopeOf(makeTest('formats'), fnScope, uniqueOwners)).toBe(true);
    expect(testInScopeOf(makeTest('x', { targetClass: 'Unrelated' }), fnScope, uniqueOwners)).toBe(true);
  });
});
