import type { CodeModel, StateNode, MethodNode } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import { resolveCoverage } from '../../resolver';
import { buildStateCatalog } from '../state-catalog';

const PROJECT_ROOT = '/project';

function resolvedFor(model: CodeModel) {
  return resolveCoverage(model, PROJECT_ROOT);
}

function emptyReasonerOutput(): ReasonerOutput {
  return {
    discoveredStates: [],
    assertionJudgments: [],
    criticalityRatings: [],
    transitiveInferences: [],
  };
}

function method(name: string): MethodNode {
  return { name, visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 };
}

/** One class OrderService in /src/order.service.ts with the given methods/states. */
function classModel(opts: { methods: string[]; states?: StateNode[]; coverage?: Record<string, string[]> }): CodeModel {
  return {
    modules: [
      {
        filePath: '/src/order.service.ts',
        classes: [
          {
            name: 'OrderService',
            type: 'service',
            methods: opts.methods.map(method),
            dependencies: [],
            states: opts.states ?? [],
          },
        ],
      },
    ],
    dependencyGraph: [],
    testInventory: { testFiles: [], coverage: opts.coverage ?? {} },
  };
}

describe('buildStateCatalog', () => {
  it('empty sources produce an empty catalog', () => {
    const model = classModel({ methods: ['submit'] });
    const catalog = buildStateCatalog(model, emptyReasonerOutput(), resolvedFor(model));
    expect(catalog.entries).toEqual([]);
    expect(catalog.droppedAmbiguous).toBe(0);
  });

  it('expands a static state affecting 3 methods into 3 entries with per-method testedness', () => {
    const model = classModel({
      methods: ['submit', 'cancel', 'refund'],
      states: [{ source: 'enum', name: 'OrderStatus', values: ['PENDING', 'PAID'], affectedMethods: ['submit', 'cancel', 'refund'] }],
      // only submit is covered
      coverage: { '/src/order.service.ts:OrderService.submit': ['t1'] },
    });
    const catalog = buildStateCatalog(model, emptyReasonerOutput(), resolvedFor(model));

    expect(catalog.entries).toHaveLength(3);
    const byMethod = Object.fromEntries(catalog.entries.map((e) => [e.methodName, e]));
    expect(byMethod['submit'].isTested).toBe(true);
    expect(byMethod['cancel'].isTested).toBe(false);
    expect(byMethod['refund'].isTested).toBe(false);
    for (const e of catalog.entries) {
      expect(e).toMatchObject({
        filePath: '/src/order.service.ts',
        owner: 'OrderService',
        stateName: 'OrderStatus',
        normalizedKey: 'orderstatus',
        provenance: 'static',
        confidence: 1,
        values: ['PENDING', 'PAID'],
      });
    }
  });

  it('forMethod returns only entries for that owner+method+file', () => {
    const model = classModel({
      methods: ['submit', 'cancel'],
      states: [{ source: 'enum', name: 'OrderStatus', values: ['PENDING'], affectedMethods: ['submit', 'cancel'] }],
    });
    const catalog = buildStateCatalog(model, emptyReasonerOutput(), resolvedFor(model));

    const entries = catalog.forMethod('OrderService', 'submit', '/src/order.service.ts');
    expect(entries).toHaveLength(1);
    expect(entries[0].methodName).toBe('submit');
    expect(catalog.forMethod('OrderService', 'submit', '/elsewhere.ts')).toEqual([]);
    expect(catalog.forMethod('OtherService', 'submit', '/src/order.service.ts')).toEqual([]);
  });
});
