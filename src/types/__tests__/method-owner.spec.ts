import {
  buildClassFileOwners,
  buildClassMethodOwners,
  classMethodKey,
  resolveClassMethodKey,
  resolveTestClassFile,
} from '../method-owner';
import type { ModuleNode } from '../code-model';

const makeModule = (filePath: string, className: string, methodNames: string[]): ModuleNode => ({
  filePath,
  classes: [{
    name: className,
    type: 'service',
    methods: methodNames.map((name) => ({ name }) as never),
    dependencies: [],
    states: [],
  }],
  functions: [],
});

describe('buildClassMethodOwners', () => {
  it('records which files declare each owning class', () => {
    const owners = buildClassMethodOwners([
      makeModule('src/a/order.service.ts', 'OrderService', ['create']),
      makeModule('src/b/order.service.ts', 'OrderService', ['create']),
      makeModule('src/c/user.service.ts', 'UserService', ['create']),
    ]);

    const createOwners = owners.get('create')!;
    expect([...createOwners.keys()].sort()).toEqual(['OrderService', 'UserService']);
    expect([...createOwners.get('OrderService')!].sort()).toEqual([
      'src/a/order.service.ts',
      'src/b/order.service.ts',
    ]);
    expect([...createOwners.get('UserService')!]).toEqual(['src/c/user.service.ts']);
  });
});

describe('resolveClassMethodKey', () => {
  const owners = buildClassMethodOwners([
    makeModule('src/a/order.service.ts', 'OrderService', ['create']),
    makeModule('src/b/order.service.ts', 'OrderService', ['create']),
    makeModule('src/c/user.service.ts', 'UserService', ['create', 'rename']),
  ]);

  it('file-qualifies the key when the class name has a single declaring file', () => {
    expect(resolveClassMethodKey('create', 'UserService', null, owners)).toBe(
      classMethodKey('src/c/user.service.ts', 'UserService', 'create')
    );
  });

  it('uses the test-resolved class file to disambiguate duplicated class names', () => {
    expect(resolveClassMethodKey('create', 'OrderService', 'src/b/order.service.ts', owners)).toBe(
      classMethodKey('src/b/order.service.ts', 'OrderService', 'create')
    );
  });

  it('fails closed when duplicated class names cannot be disambiguated', () => {
    expect(resolveClassMethodKey('create', 'OrderService', null, owners)).toBeNull();
    expect(resolveClassMethodKey('create', 'OrderService', 'src/elsewhere.ts', owners)).toBeNull();
  });

  it('fails closed without a resolved target class', () => {
    expect(resolveClassMethodKey('create', null, null, owners)).toBeNull();
  });

  it('returns null for methods no class owns', () => {
    expect(resolveClassMethodKey('standaloneFn', 'OrderService', null, owners)).toBeNull();
  });
});

describe('resolveTestClassFile', () => {
  const owners = buildClassFileOwners([
    makeModule('src/a/order.service.ts', 'OrderService', ['create']),
    makeModule('src/b/order.service.ts', 'OrderService', ['create']),
    makeModule('src/c/user.service.ts', 'UserService', ['create']),
  ]);

  it('resolves the file of a uniquely-named class without an import signal', () => {
    expect(resolveTestClassFile('UserService', null, owners)).toBe('src/c/user.service.ts');
  });

  it('uses the resolved import file to break duplicate-name ties', () => {
    expect(resolveTestClassFile('OrderService', 'src/b/order.service.ts', owners)).toBe(
      'src/b/order.service.ts'
    );
  });

  it('fails closed on unresolvable duplicates and unknown classes', () => {
    expect(resolveTestClassFile('OrderService', null, owners)).toBeNull();
    expect(resolveTestClassFile('OrderService', 'src/elsewhere.ts', owners)).toBeNull();
    expect(resolveTestClassFile('GhostService', null, owners)).toBeNull();
    expect(resolveTestClassFile(null, null, owners)).toBeNull();
  });
});
