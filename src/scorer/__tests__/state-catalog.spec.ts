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

  it('applies the coverage floor to reasoner isTested', () => {
    // Reasoner says tested, but the method has no coverage → not tested.
    const model = classModel({ methods: ['submit'] });
    const reasoner: ReasonerOutput = {
      ...emptyReasonerOutput(),
      discoveredStates: [
        { className: 'OrderService', methodName: 'submit', state: 'already cancelled', isTested: true, riskIfUntested: 'high', confidence: 0.9 },
      ],
    };
    const catalog = buildStateCatalog(model, reasoner, resolvedFor(model));

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      owner: 'OrderService',
      filePath: '/src/order.service.ts',
      stateName: 'already cancelled',
      provenance: 'reasoner',
      isTested: false,
      confidence: 0.9,
      riskIfUntested: 'high',
    });
  });

  it('keeps reasoner isTested when the method is covered', () => {
    const model = classModel({
      methods: ['submit'],
      coverage: { '/src/order.service.ts:OrderService.submit': ['t1'] },
    });
    const reasoner: ReasonerOutput = {
      ...emptyReasonerOutput(),
      discoveredStates: [
        { className: 'OrderService', methodName: 'submit', state: 'already cancelled', isTested: true, riskIfUntested: 'high', confidence: 0.9 },
      ],
    };
    const catalog = buildStateCatalog(model, reasoner, resolvedFor(model));
    expect(catalog.entries[0].isTested).toBe(true);
  });

  it('drops reasoner states whose class is declared in several files', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/a/order.service.ts',
          classes: [{ name: 'OrderService', type: 'service', methods: [method('submit')], dependencies: [], states: [] }],
        },
        {
          filePath: '/src/b/order.service.ts',
          classes: [{ name: 'OrderService', type: 'service', methods: [method('submit')], dependencies: [], states: [] }],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: {} },
    };
    const reasoner: ReasonerOutput = {
      ...emptyReasonerOutput(),
      discoveredStates: [
        { className: 'OrderService', methodName: 'submit', state: 'ambiguous', isTested: false, riskIfUntested: 'high', confidence: 0.9 },
      ],
    };
    const catalog = buildStateCatalog(model, reasoner, resolvedFor(model));
    expect(catalog.entries).toEqual([]);
    expect(catalog.droppedAmbiguous).toBe(1);
  });

  it('resolves standalone-function owners to themselves', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/utils.ts',
          classes: [],
          functions: [{ ...method('parseAmount'), visibility: 'public' as const }],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: { parseAmount: ['t1'] } },
    };
    const reasoner: ReasonerOutput = {
      ...emptyReasonerOutput(),
      discoveredStates: [
        { className: '/src/utils.ts', methodName: 'parseAmount', state: 'negative amount', isTested: true, riskIfUntested: 'medium', confidence: 0.8 },
      ],
    };
    const catalog = buildStateCatalog(model, reasoner, resolvedFor(model));

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0].owner).toBe('/src/utils.ts');
    expect(catalog.entries[0].filePath).toBe('/src/utils.ts');
    expect(catalog.droppedAmbiguous).toBe(0);
  });
});
