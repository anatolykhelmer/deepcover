import type { ModuleNode, CallableNode } from '../code-model';
import { allCallables, methodCoverageKey, functionCoverageKey, calleeKey } from '../callable';

function makeNode(name: string, visibility: CallableNode['visibility'] = 'public'): CallableNode {
  return {
    name, visibility, params: [], returnType: 'void', branches: [], branchCount: 0,
    throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [],
    startLine: 1, endLine: 2,
  };
}

const mod: ModuleNode = {
  filePath: 'src/orders/order.service.ts',
  classes: [{
    name: 'OrderService', type: 'service', dependencies: [], states: [],
    methods: [makeNode('create'), makeNode('audit', 'private')],
  }],
  functions: [makeNode('formatOrderId')],
};

describe('allCallables', () => {
  it('yields class methods then standalone functions with correct identity fields', () => {
    const all = [...allCallables(mod)];
    expect(all).toHaveLength(3);

    const create = all[0];
    expect(create.ownerKind).toBe('class');
    expect(create.owner).toBe('OrderService');
    expect(create.filePath).toBe('src/orders/order.service.ts');
    expect(create.qualifiedName).toBe('OrderService.create');
    expect(create.key).toBe('src/orders/order.service.ts:OrderService.create');
    expect(create.inventoryKey).toBe('src/orders/order.service.ts:OrderService.create');

    const fn = all[2];
    expect(fn.ownerKind).toBe('module');
    expect(fn.owner).toBe('src/orders/order.service.ts');
    expect(fn.qualifiedName).toBe('src/orders/order.service.ts.formatOrderId');
    expect(fn.key).toBe('src/orders/order.service.ts:formatOrderId');
    // functions keep the bare-name inventory key (frozen artifact contract)
    expect(fn.inventoryKey).toBe('formatOrderId');
  });

  it('handles a module with no functions array', () => {
    const bare: ModuleNode = { filePath: 'a.ts', classes: [] };
    expect([...allCallables(bare)]).toHaveLength(0);
  });
});

describe('coverage keys', () => {
  it('method and function keys in the same file never collide', () => {
    expect(methodCoverageKey('f.ts', 'C', 'm')).toBe('f.ts:C.m');
    expect(functionCoverageKey('f.ts', 'm')).toBe('f.ts:m');
    expect(methodCoverageKey('f.ts', 'C', 'm')).not.toBe(functionCoverageKey('f.ts', 'm'));
  });

  it('calleeKey stays inside the caller scope', () => {
    const all = [...allCallables(mod)];
    expect(calleeKey(all[0], 'audit')).toBe('src/orders/order.service.ts:OrderService.audit');
    expect(calleeKey(all[2], 'other')).toBe('src/orders/order.service.ts:other');
  });
});
