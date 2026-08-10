import type { AssertionNode, CodeModel, MethodNode, StateNode } from '../../types/code-model';
import type { DiscoveredState, ReasonerOutput } from '../../reasoner/types';
import type { SubScore } from '../types';
import { resolveCoverage } from '../../resolver';
import { composeScore } from '../composer';

const PROJECT_ROOT = '/project';

function emptyReasonerOutput(): ReasonerOutput {
  return {
    discoveredStates: [],
    assertionJudgments: [],
    criticalityRatings: [],
    transitiveInferences: [],
  };
}

function makeSubScores(overrides?: Partial<SubScore>): {
  assertionQuality: SubScore;
  stateCoverage: SubScore;
  mutationResilience: SubScore;
  criticalityWeighting: SubScore;
} {
  const def: SubScore = { base: 50, llmAdjustment: 0, final: 50, confidence: 0, applicable: true };
  const s = { ...def, ...overrides };
  return {
    assertionQuality: s,
    stateCoverage: s,
    mutationResilience: s,
    criticalityWeighting: s,
  };
}

describe('composer', () => {
  const minimalModel: CodeModel = {
    modules: [
      {
        filePath: '/src/s.ts',
        functions: [],
        classes: [
          {
            name: 'ItemService',
            type: 'service',
            methods: [
              { name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
              { name: 'getById', visibility: 'public', params: [], returnType: 'Item', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
            ],
            dependencies: [],
            states: [],
          },
        ],
      },
    ],
    dependencyGraph: [],
    testInventory: {
      testFiles: [
        {
          filePath: '/t.spec.ts',
          describes: [
            {
              name: 'ItemService',
              tests: [
                { name: 't1', targetMethod: 'getAll', assertions: [], mocks: [], isAsync: false, targetClass: 'ItemService' },
              ],
            },
          ],
        },
      ],
      coverage: { 'ItemService.getAll': ['t1'], 'ItemService.getById': [] },
    },
  };

  it('composite is weighted sum of sub-scores (0.30, 0.30, 0.25, 0.15)', () => {
    const subScores = {
      assertionQuality: { base: 100, llmAdjustment: 0, final: 100, confidence: 0, applicable: true },
      stateCoverage: { base: 100, llmAdjustment: 0, final: 100, confidence: 0, applicable: true },
      mutationResilience: { base: 100, llmAdjustment: 0, final: 100, confidence: 0, applicable: true },
      criticalityWeighting: { base: 100, llmAdjustment: 0, final: 100, confidence: 0, applicable: true },
    };
    const resolved = resolveCoverage(minimalModel, PROJECT_ROOT);
    const result = composeScore(subScores, minimalModel, emptyReasonerOutput(), resolved);
    expect(result.composite).toBe(100);
  });

  it('composite uses weighted sum: 0.30*80 + 0.30*60 + 0.25*40 + 0.15*20 = 58', () => {
    const subScores = {
      assertionQuality: { base: 80, llmAdjustment: 0, final: 80, confidence: 0, applicable: true },
      stateCoverage: { base: 60, llmAdjustment: 0, final: 60, confidence: 0, applicable: true },
      mutationResilience: { base: 40, llmAdjustment: 0, final: 40, confidence: 0, applicable: true },
      criticalityWeighting: { base: 20, llmAdjustment: 0, final: 20, confidence: 0, applicable: true },
    };
    const resolved = resolveCoverage(minimalModel, PROJECT_ROOT);
    const result = composeScore(subScores, minimalModel, emptyReasonerOutput(), resolved);
    expect(result.composite).toBeCloseTo(0.3 * 80 + 0.3 * 60 + 0.25 * 40 + 0.15 * 20, 1);
  });

  it('per-function scores generated for each method', () => {
    const subScores = makeSubScores();
    const resolved = resolveCoverage(minimalModel, PROJECT_ROOT);
    const result = composeScore(subScores, minimalModel, emptyReasonerOutput(), resolved);
    expect(result.perFunction).toHaveLength(2);
    expect(result.perFunction.map((f) => f.methodName)).toEqual(expect.arrayContaining(['getAll', 'getById']));
    expect(result.perFunction.every((f) => f.className === 'ItemService')).toBe(true);
    expect(result.perFunction.every((f) => typeof f.composite === 'number')).toBe(true);
    expect(result.perFunction.every((f) => ['low', 'medium', 'high'].includes(f.criticality))).toBe(true);
  });

  it('custom weights work correctly', () => {
    const subScores = {
      assertionQuality: { base: 100, llmAdjustment: 0, final: 100, confidence: 0, applicable: true },
      stateCoverage: { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: true },
      mutationResilience: { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: true },
      criticalityWeighting: { base: 0, llmAdjustment: 0, final: 0, confidence: 0, applicable: true },
    };
    const resolved = resolveCoverage(minimalModel, PROJECT_ROOT);
    const result = composeScore(subScores, minimalModel, emptyReasonerOutput(), resolved, {
      assertionQuality: 1,
      stateCoverage: 0,
      mutationResilience: 0,
      criticalityWeighting: 0,
    });
    expect(result.composite).toBe(100);
  });

  it('includes standalone functions in per-function breakdown', () => {
    const modelWithStandalone: CodeModel = {
      modules: [
        {
          filePath: '/src/formatter.ts',
          classes: [],
          functions: [
            {
              name: 'formatError',
              visibility: 'public',
              params: [{ name: 'input', type: 'string', isOptional: false }],
              returnType: 'string',
              branches: [],
              branchCount: 0,
              throwsErrors: false,
              hasAsyncOps: false,
              externalCalls: [],
              internalCalls: [],
              startLine: 1,
              endLine: 3,
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: {
        testFiles: [
          {
            filePath: '/t.spec.ts',
            describes: [
              {
                name: 'formatError',
                tests: [{ name: 't', targetMethod: 'formatError', assertions: [], mocks: [], isAsync: false }],
              },
            ],
          },
        ],
        coverage: { formatError: ['t'] },
      },
    };

    const resolved = resolveCoverage(modelWithStandalone, PROJECT_ROOT);
    const result = composeScore(makeSubScores(), modelWithStandalone, emptyReasonerOutput(), resolved);
    expect(result.perFunction).toHaveLength(1);
    expect(result.perFunction[0].className).toBe('/src/formatter.ts');
    expect(result.perFunction[0].methodName).toBe('formatError');
    expect(result.perFunction[0].composite).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- *
   * Per-method rollup: reasoner states and matcher classification     *
   * ---------------------------------------------------------------- */

  const CHARGE_START = 10;
  const CHARGE_END = 20;

  function method(name: string, overrides: Partial<MethodNode> = {}): MethodNode {
    return {
      name,
      visibility: 'public',
      params: [],
      returnType: 'Promise<Receipt>',
      branches: [],
      branchCount: 0,
      throwsErrors: false,
      hasAsyncOps: true,
      externalCalls: [],
      internalCalls: [],
      startLine: CHARGE_START,
      endLine: CHARGE_END,
      ...overrides,
    };
  }

  function discoveredState(overrides: Partial<DiscoveredState> = {}): DiscoveredState {
    return {
      className: 'PaymentGateway',
      methodName: 'charge',
      state: 'authorized',
      isTested: true,
      riskIfUntested: 'medium',
      confidence: 0.9,
      ...overrides,
    };
  }

  /** Istanbul data covering `charge`'s whole line range at 100% lines and branches. */
  function fullyCoveredIstanbul(filePath: string) {
    const statementMap: Record<string, { start: { line: number; column: number }; end: { line: number; column: number } }> = {};
    const s: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      const line = CHARGE_START + i;
      statementMap[String(i)] = { start: { line, column: 0 }, end: { line, column: 10 } };
      s[String(i)] = 1;
    }
    return {
      [filePath]: {
        statementMap,
        s,
        branchMap: {
          '0': { loc: { start: { line: CHARGE_START + 1 }, end: { line: CHARGE_START + 2 } }, type: 'if' },
        },
        b: { '0': [1, 1] },
        fnMap: {
          '0': { name: 'charge', loc: { start: { line: CHARGE_START }, end: { line: CHARGE_END } } },
        },
        f: { '0': 1 },
      },
    };
  }

  /**
   * Mirrors nest-app1's PaymentGateway: no static `states`, a dedicated spec
   * file, and four direct tests whose assertions use `resolves` / `rejects`.
   */
  function paymentGatewayModel(assertions: AssertionNode[], states: StateNode[] = []): CodeModel {
    return {
      modules: [
        {
          filePath: 'src/orders/payment.gateway.ts',
          functions: [],
          classes: [
            {
              name: 'PaymentGateway',
              type: 'service',
              methods: [method('charge')],
              dependencies: [],
              states,
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: {
        testFiles: [
          {
            filePath: 'src/orders/payment.gateway.spec.ts',
            describes: [
              {
                name: 'PaymentGateway',
                tests: [
                  { name: 'charges a card', targetMethod: 'charge', assertions, mocks: [], isAsync: true, targetClass: 'PaymentGateway' },
                ],
              },
            ],
          },
        ],
        coverage: { 'PaymentGateway.charge': ['charges a card'] },
      },
    };
  }

  function scoreCharge(model: CodeModel, discoveredStates: DiscoveredState[] = []) {
    const istanbul = fullyCoveredIstanbul(`${PROJECT_ROOT}/src/orders/payment.gateway.ts`);
    const resolved = resolveCoverage(model, PROJECT_ROOT, { istanbul });
    const reasoner = { ...emptyReasonerOutput(), discoveredStates };
    const result = composeScore(makeSubScores(), model, reasoner, resolved);
    const charge = result.perFunction.find((f) => f.methodName === 'charge');
    if (!charge) throw new Error('charge not scored');
    return charge;
  }

  describe('per-method state rollup (DEFECT 1)', () => {
    const strongAssertions: AssertionNode[] = [
      { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toEqual' },
    ];

    it('counts reasoner discoveredStates when the class has no static states', () => {
      const charge = scoreCharge(paymentGatewayModel(strongAssertions), [
        discoveredState({ state: 'authorized' }),
        discoveredState({ state: 'declined' }),
        discoveredState({ state: 'network error' }),
        discoveredState({ state: 'idempotent replay' }),
      ]);

      expect(charge.totalStates).toBe(4);
      expect(charge.testedStates).toBe(4);
    });

    it('a fully tested method scores above the 65-point cap the missing join imposed', () => {
      // Four strong assertions saturate the 35-point assertion share, so the
      // only headroom left is the state share.
      const model = paymentGatewayModel([
        { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toEqual' },
        { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toEqual' },
        { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toStrictEqual' },
        { type: 'rejects', target: 'gateway.charge(bad)', matcherUsed: 'toThrow' },
      ]);
      const states = [
        discoveredState({ state: 'authorized' }),
        discoveredState({ state: 'declined' }),
      ];

      const withoutStates = scoreCharge(model);
      const withStates = scoreCharge(model, states);

      // 30 (Istanbul lines) + 0 (no states) + 35 (assertions, capped)
      expect(withoutStates.composite).toBeCloseTo(65, 5);
      // 30 + 35 (2/2 states) + 35 → clamped to 100
      expect(withStates.composite).toBeGreaterThan(65);
    });

    it('scores partially tested reasoner states proportionally', () => {
      const charge = scoreCharge(paymentGatewayModel([]), [
        discoveredState({ state: 'authorized', isTested: true }),
        discoveredState({ state: 'declined', isTested: true }),
        discoveredState({ state: 'network error', isTested: false }),
        discoveredState({ state: 'idempotent replay', isTested: false }),
      ]);

      expect(charge.testedStates).toBe(2);
      expect(charge.totalStates).toBe(4);
      // 30 (Istanbul lines) + 2/4 * 35 + 0 (no assertions)
      expect(charge.composite).toBeCloseTo(30 + 17.5, 5);
    });

    it('merges static states with reasoner states instead of replacing them', () => {
      const staticStates: StateNode[] = [
        { source: 'enum', name: 'CardBrand', values: ['visa', 'amex'], affectedMethods: ['charge'] },
      ];
      const charge = scoreCharge(paymentGatewayModel([], staticStates), [
        discoveredState({ state: 'declined' }),
      ]);

      expect(charge.totalStates).toBe(2);
      expect(charge.testedStates).toBe(2);
    });

    it('counts a state named by both sources once', () => {
      const staticStates: StateNode[] = [
        { source: 'union_type', name: 'declined', values: [], affectedMethods: ['charge'] },
      ];
      const charge = scoreCharge(paymentGatewayModel([], staticStates), [
        discoveredState({ state: 'Declined' }),
      ]);

      expect(charge.totalStates).toBe(1);
    });

    it('ignores reasoner states belonging to another class or method', () => {
      const charge = scoreCharge(paymentGatewayModel([]), [
        discoveredState({ className: 'OrdersService', state: 'insufficient stock' }),
        discoveredState({ methodName: 'refund', state: 'already refunded' }),
      ]);

      expect(charge.totalStates).toBe(0);
      expect(charge.composite).toBeCloseTo(30, 5);
    });

    it('does not credit a reasoner state as tested when the method has no coverage', () => {
      const model = paymentGatewayModel([]);
      model.testInventory.coverage = { 'PaymentGateway.charge': [] };
      const resolved = resolveCoverage(model, PROJECT_ROOT);
      const reasoner = {
        ...emptyReasonerOutput(),
        discoveredStates: [discoveredState({ state: 'authorized', isTested: true })],
      };

      const result = composeScore(makeSubScores(), model, reasoner, resolved);
      const charge = result.perFunction.find((f) => f.methodName === 'charge')!;

      expect(charge.totalStates).toBe(1);
      expect(charge.testedStates).toBe(0);
    });
  });

  describe('matcher classification (DEFECT 2)', () => {
    it('counts resolves/rejects assertions the extractor records by terminal matcher', () => {
      const charge = scoreCharge(
        paymentGatewayModel([
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toEqual' },
          { type: 'rejects', target: 'gateway.charge(bad)', matcherUsed: 'toThrow' },
        ])
      );

      expect(charge.strongAssertions).toBe(2);
    });

    it('classifies a stale `resolves` matcher by unwrapping the modifier', () => {
      // Models produced before the extractor fix still carry the bare modifier.
      const charge = scoreCharge(
        paymentGatewayModel([
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'resolves.toEqual' },
        ])
      );

      expect(charge.strongAssertions).toBe(1);
    });

    it('a method with only resolves assertions is no longer reported as untested', () => {
      const charge = scoreCharge(
        paymentGatewayModel([
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toEqual' },
        ])
      );

      // The terminal formatter reads these to decide "transitive coverage only".
      expect(charge.strongAssertions + (charge.mediumAssertions ?? 0) + charge.weakAssertions)
        .toBeGreaterThan(0);
      expect(charge.composite).toBeGreaterThan(30);
    });

    it('counts toMatchObject and toBeCloseTo as strong', () => {
      const charge = scoreCharge(
        paymentGatewayModel([
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toMatchObject' },
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toBeCloseTo' },
        ])
      );

      expect(charge.strongAssertions).toBe(2);
      expect(charge.weakAssertions).toBe(0);
    });

    it('tallies medium matchers separately from strong and weak', () => {
      const charge = scoreCharge(
        paymentGatewayModel([
          { type: 'spy_call_count', target: 'gateway.charge(order)', matcherUsed: 'toHaveBeenCalledTimes' },
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toHaveLength' },
          { type: 'value_check', target: 'gateway.charge(order)', matcherUsed: 'toBeDefined' },
        ])
      );

      expect(charge.strongAssertions).toBe(0);
      expect(charge.mediumAssertions).toBe(2);
      expect(charge.weakAssertions).toBe(1);
      // 30 (Istanbul lines) + 0 states + (2*5 + 1*2) assertion points
      expect(charge.composite).toBeCloseTo(42, 5);
    });
  });

  /**
   * Regression for the reported leak: a same-named method on a completely unrelated,
   * untested class must not inherit another class's test credit just because an
   * assertion's expression happens to textually call `.doThing(...)`.
   */
  describe('cross-class method-name collision (reported leak)', () => {
    function twoClassModel(): CodeModel {
      return {
        modules: [
          {
            filePath: '/src/moduleA/a.service.ts',
            functions: [],
            classes: [
              {
                name: 'AService',
                type: 'service',
                methods: [method('doThing', { startLine: 1, endLine: 3 })],
                dependencies: [],
                states: [],
              },
            ],
          },
          {
            filePath: '/src/moduleB/b.service.ts',
            functions: [],
            classes: [
              {
                name: 'BService',
                type: 'service',
                methods: [method('doThing', { startLine: 1, endLine: 3 })],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: {
          testFiles: [
            {
              filePath: '/src/moduleA/a.service.spec.ts',
              describes: [
                {
                  name: 'AService',
                  tests: [
                    {
                      name: 'adds one',
                      targetMethod: 'doThing',
                      targetClass: 'AService',
                      assertions: [
                        { type: 'value_check', target: 'new AService().doThing(1)', matcherUsed: 'toBe' },
                      ],
                      mocks: [],
                      isAsync: false,
                    },
                  ],
                },
              ],
            },
          ],
          coverage: { 'AService.doThing': ['adds one'] },
        },
      };
    }

    it('gives the untested class zero assertion credit, consistent with "no test coverage"', () => {
      const model = twoClassModel();
      const resolved = resolveCoverage(model, PROJECT_ROOT);
      const result = composeScore(makeSubScores(), model, emptyReasonerOutput(), resolved);

      const bThing = result.perFunction.find((f) => f.className === 'BService' && f.methodName === 'doThing');
      expect(bThing).toBeDefined();
      expect(bThing!.strongAssertions).toBe(0);
      expect(bThing!.mediumAssertions).toBe(0);
      expect(bThing!.weakAssertions).toBe(0);
      expect(bThing!.untested).toContain('no test coverage');
      expect(bThing!.composite).toBe(0);
    });

    it('still gives the actually-tested class its own credit', () => {
      const model = twoClassModel();
      const resolved = resolveCoverage(model, PROJECT_ROOT);
      const result = composeScore(makeSubScores(), model, emptyReasonerOutput(), resolved);

      const aThing = result.perFunction.find((f) => f.className === 'AService' && f.methodName === 'doThing');
      expect(aThing).toBeDefined();
      expect(aThing!.strongAssertions).toBe(1);
      expect(aThing!.untested).not.toContain('no test coverage');
    });
  });
});
