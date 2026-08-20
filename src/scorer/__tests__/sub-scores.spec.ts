import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import { resolveCoverage } from '../../resolver';
import { calculateAssertionQuality } from '../assertion-quality';
import { calculateStateCoverage } from '../state-coverage';
import { buildStateCatalog } from '../state-catalog';
import { calculateMutationResilience } from '../mutation-resilience';
import { calculateCriticalityWeighting } from '../criticality';

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

describe('sub-score calculators', () => {
  describe('assertion-quality', () => {
    it('weak assertions score lower than strong', () => {
      const weakModel: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
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
              filePath: '/test/item.spec.ts',
              describes: [
                {
                  name: 'ItemService',
                  tests: [
                    { name: 'weak', targetMethod: 'getAll', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBeDefined' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                    { name: 'weak2', targetMethod: 'getAll', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBeTruthy' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                  ],
                },
              ],
            },
          ],
          coverage: { '/src/item.service.ts:ItemService.getAll': ['weak', 'weak2'] },
        },
      };

      const strongModel: CodeModel = {
        ...weakModel,
        testInventory: {
          testFiles: [
            {
              filePath: '/test/item.spec.ts',
              describes: [
                {
                  name: 'ItemService',
                  tests: [
                    { name: 'strong', targetMethod: 'getAll', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                    { name: 'strong2', targetMethod: 'getAll', assertions: [{ type: 'called_with', target: 'repo.findAll', matcherUsed: 'toHaveBeenCalledWith' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                  ],
                },
              ],
            },
          ],
          coverage: { '/src/item.service.ts:ItemService.getAll': ['strong', 'strong2'] },
        },
      };

      const insights = emptyReasonerOutput();
      const weakScore = calculateAssertionQuality(weakModel, insights, resolvedFor(weakModel));
      const strongScore = calculateAssertionQuality(strongModel, insights, resolvedFor(strongModel));

      expect(strongScore.base).toBeGreaterThan(weakScore.base);
    });

    it('no tests = score 0 for assertion quality', () => {
      const noTestsModel: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: {} },
      };

      const score = calculateAssertionQuality(noTestsModel, emptyReasonerOutput(), resolvedFor(noTestsModel));
      expect(score.base).toBe(0);
    });

    it('LLM adjustment is clamped to ±20', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
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
              filePath: '/test/item.spec.ts',
              describes: [
                {
                  name: 'ItemService',
                  tests: [
                    { name: 't', targetMethod: 'getAll', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                  ],
                },
              ],
            },
          ],
          coverage: { '/src/item.service.ts:ItemService.getAll': ['t'] },
        },
      };

      const extremePositive: ReasonerOutput = {
        discoveredStates: [],
        assertionJudgments: [
          { testName: 't', quality: 'strong', reasoning: 'x', confidence: 1 },
          { testName: 't', quality: 'strong', reasoning: 'x', confidence: 1 },
        ],
        criticalityRatings: [],
        transitiveInferences: [],
      };

      const score = calculateAssertionQuality(model, extremePositive, resolvedFor(model));
      expect(score.llmAdjustment).toBeLessThanOrEqual(20);
      expect(score.final).toBeLessThanOrEqual(100);
    });
  });

  describe('state-coverage', () => {
    it('empty catalog = not applicable', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: {} },
      };

      const resolved = resolvedFor(model);
      const score = calculateStateCoverage(buildStateCatalog(model, emptyReasonerOutput(), resolved), resolved);
      expect(score.base).toBe(0);
      expect(score.applicable).toBe(false);
    });

    it('all discoveredStates tested = high base', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [
                  { name: 'm1', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                ],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: { '/src/s.ts:S.m1': ['t1'] } },
      };
      const reasoner: ReasonerOutput = {
        discoveredStates: [
          { className: 'S', methodName: 'm1', state: 'state-a', isTested: true, riskIfUntested: 'high', confidence: 0.9 },
          { className: 'S', methodName: 'm1', state: 'state-b', isTested: true, riskIfUntested: 'medium', confidence: 0.8 },
        ],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: [],
      };

      const resolved = resolvedFor(model);
      const score = calculateStateCoverage(buildStateCatalog(model, reasoner, resolved), resolved);
      expect(score.applicable).toBe(true);
      expect(score.base).toBeGreaterThan(0);
      expect(score.confidence).toBeGreaterThan(0);
    });

    it('partial discoveredStates tested scores lower than all tested', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [
                  { name: 'm1', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                ],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: { '/src/s.ts:S.m1': ['t1'] } },
      };
      const allTested: ReasonerOutput = {
        discoveredStates: [
          { className: 'S', methodName: 'm1', state: 'state-a', isTested: true, riskIfUntested: 'high', confidence: 1 },
          { className: 'S', methodName: 'm1', state: 'state-b', isTested: true, riskIfUntested: 'high', confidence: 1 },
        ],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: [],
      };
      const halfTested: ReasonerOutput = {
        discoveredStates: [
          { className: 'S', methodName: 'm1', state: 'state-a', isTested: true, riskIfUntested: 'high', confidence: 1 },
          { className: 'S', methodName: 'm1', state: 'state-b', isTested: false, riskIfUntested: 'high', confidence: 1 },
        ],
        assertionJudgments: [],
        criticalityRatings: [],
        transitiveInferences: [],
      };

      const resolved = resolvedFor(model);
      const allScore = calculateStateCoverage(buildStateCatalog(model, allTested, resolved), resolved);
      const halfScore = calculateStateCoverage(buildStateCatalog(model, halfTested, resolved), resolved);
      expect(halfScore.base).toBeLessThan(allScore.base);
      expect(halfScore.applicable).toBe(true);
      expect(allScore.applicable).toBe(true);
    });

    it('static states alone make the metric applicable (no reasoner run)', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [
                  { name: 'm1', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                  { name: 'm2', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                ],
                dependencies: [],
                states: [{ source: 'enum', name: 'Mode', values: ['ON', 'OFF'], affectedMethods: ['m1', 'm2'] }],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: { '/src/s.ts:S.m1': ['t1'] } },
      };
      const resolved = resolvedFor(model);
      const score = calculateStateCoverage(buildStateCatalog(model, emptyReasonerOutput(), resolved), resolved);

      expect(score.applicable).toBe(true);
      // 2 entries (m1 tested, m2 not), confidence 1.0, no Istanbul → base 50.
      expect(score.base).toBeCloseTo(50, 5);
      expect(score.confidence).toBe(1);
    });

    it('reasoner isTested without real coverage no longer inflates the aggregate', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [
                  { name: 'm1', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                ],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: {} }, // m1 uncovered
      };
      const reasoner: ReasonerOutput = {
        ...emptyReasonerOutput(),
        discoveredStates: [
          { className: 'S', methodName: 'm1', state: 'state-a', isTested: true, riskIfUntested: 'high', confidence: 1 },
        ],
      };
      const resolved = resolvedFor(model);
      const score = calculateStateCoverage(buildStateCatalog(model, reasoner, resolved), resolved);

      expect(score.applicable).toBe(true);
      expect(score.base).toBe(0);
    });
  });

  describe('mutation-resilience', () => {
    it('no tests = score 0 for mutation resilience', () => {
      const noTestsModel: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
                dependencies: [],
                states: [],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: {} },
      };

      const score = calculateMutationResilience(noTestsModel, emptyReasonerOutput(), resolvedFor(noTestsModel));
      expect(score.base).toBe(0);
    });

    it('does not tally another file\'s tests for a same-named class (task 021)', () => {
      // /src/a and /src/b both declare OrderService.create. Only a/ has real
      // tests (strong); b/ is marked covered without its own tests. A weak-tested
      // UserService makes any leaked copy of a's strong specificity shift the
      // global average, so the duplicate-name model must score the same as a
      // control model where b's class has a unique name.
      const method = (name: string) => ({
        name, visibility: 'public' as const, params: [], returnType: 'void',
        branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false,
        externalCalls: [], internalCalls: [], startLine: 1, endLine: 1,
      });
      const buildModel = (bClassName: string): CodeModel => ({
        modules: [
          {
            filePath: '/src/a/order.service.ts',
            classes: [{ name: 'OrderService', type: 'service', methods: [method('create')], dependencies: [], states: [] }],
          },
          {
            filePath: '/src/b/order.service.ts',
            classes: [{ name: bClassName, type: 'service', methods: [method('create')], dependencies: [], states: [] }],
          },
          {
            filePath: '/src/c/user.service.ts',
            classes: [{ name: 'UserService', type: 'service', methods: [method('find')], dependencies: [], states: [] }],
          },
        ],
        dependencyGraph: [],
        testInventory: {
          testFiles: [
            {
              filePath: '/src/a/order.service.spec.ts',
              describes: [{
                name: 'OrderService',
                tests: [{
                  name: 'creates strongly', targetMethod: 'create', targetClass: 'OrderService',
                  targetClassFile: '/src/a/order.service.ts',
                  assertions: [{ type: 'called_with', target: 'repo.save', matcherUsed: 'toHaveBeenCalledWith' }],
                  mocks: [], isAsync: false,
                }],
              }],
            },
            {
              filePath: '/src/c/user.service.spec.ts',
              describes: [{
                name: 'UserService',
                tests: [{
                  name: 'finds weakly', targetMethod: 'find', targetClass: 'UserService',
                  targetClassFile: '/src/c/user.service.ts',
                  assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBeDefined' }],
                  mocks: [], isAsync: false,
                }],
              }],
            },
          ],
          coverage: {
            '/src/a/order.service.ts:OrderService.create': ['creates strongly'],
            [`/src/b/order.service.ts:${bClassName}.create`]: ['covered elsewhere'],
            '/src/c/user.service.ts:UserService.find': ['finds weakly'],
          },
        },
      });

      const duplicate = buildModel('OrderService');
      const control = buildModel('OrderServiceB');

      const duplicateScore = calculateMutationResilience(duplicate, emptyReasonerOutput(), resolvedFor(duplicate));
      const controlScore = calculateMutationResilience(control, emptyReasonerOutput(), resolvedFor(control));

      expect(duplicateScore.base).toBeCloseTo(controlScore.base, 10);
    });
  });

  describe('criticality-weighting', () => {
    it('high-criticality untested methods hurt more than low-criticality ones', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [
                  { name: 'highComplex', visibility: 'public', params: [], returnType: 'void', branches: [{ type: 'if', condition: 'x', lineNumber: 1 }], branchCount: 3, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                  { name: 'lowComplex', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
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
              filePath: '/test/item.spec.ts',
              describes: [
                {
                  name: 'ItemService',
                  tests: [
                    { name: 't', targetMethod: 'lowComplex', assertions: [{ type: 'value_check', target: 'r', matcherUsed: 'toEqual' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                  ],
                },
              ],
            },
          ],
          coverage: { '/src/item.service.ts:ItemService.lowComplex': ['t'] },
        },
      };

      const highUntested: ReasonerOutput = {
        discoveredStates: [],
        assertionJudgments: [],
        criticalityRatings: [
          { className: 'ItemService', methodName: 'highComplex', criticality: 'high', reasoning: 'x', confidence: 0.9 },
          { className: 'ItemService', methodName: 'lowComplex', criticality: 'low', reasoning: 'x', confidence: 0.9 },
        ],
        transitiveInferences: [],
      };

      const lowUntested: ReasonerOutput = {
        discoveredStates: [],
        assertionJudgments: [],
        criticalityRatings: [
          { className: 'ItemService', methodName: 'highComplex', criticality: 'low', reasoning: 'x', confidence: 0.9 },
          { className: 'ItemService', methodName: 'lowComplex', criticality: 'high', reasoning: 'x', confidence: 0.9 },
        ],
        transitiveInferences: [],
      };

      const scoreHighUntested = calculateCriticalityWeighting(model, highUntested, resolvedFor(model));
      const scoreLowUntested = calculateCriticalityWeighting(model, lowUntested, resolvedFor(model));

      expect(scoreHighUntested.base).toBeLessThan(scoreLowUntested.base);
    });
  });

  describe('no LLM = base only', () => {
    it('with empty ReasonerOutput, final equals base for all calculators', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [{ name: 'get', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
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
              describes: [{ name: 'S', tests: [{ name: 't', targetMethod: 'get', assertions: [{ type: 'value_check', target: 'r', matcherUsed: 'toEqual' }], mocks: [], isAsync: false, targetClass: 'S' }] }],
            },
          ],
          coverage: { '/src/s.ts:S.get': ['t'] },
        },
      };
      const empty = emptyReasonerOutput();
      const r = resolvedFor(model);
      expect(calculateAssertionQuality(model, empty, r).final).toBe(calculateAssertionQuality(model, empty, r).base);
      expect(calculateStateCoverage(buildStateCatalog(model, empty, r), r).final).toBe(calculateStateCoverage(buildStateCatalog(model, empty, r), r).base);
      expect(calculateMutationResilience(model, empty, r).final).toBe(calculateMutationResilience(model, empty, r).base);
      expect(calculateCriticalityWeighting(model, empty, r).final).toBe(calculateCriticalityWeighting(model, empty, r).base);
    });
  });

  describe('zero tests = zero scores', () => {
    it('no tests yields base 0 for state coverage and mutation resilience', () => {
      const noTestsModel: CodeModel = {
        modules: [
          {
            filePath: '/src/s.ts',
            classes: [
              {
                name: 'S',
                type: 'service',
                methods: [{ name: 'get', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
                dependencies: [],
                states: [{ source: 'enum', name: 'X', values: ['a'], affectedMethods: ['get'] }],
              },
            ],
          },
        ],
        dependencyGraph: [],
        testInventory: { testFiles: [], coverage: {} },
      };
      const r = resolvedFor(noTestsModel);
      expect(calculateStateCoverage(buildStateCatalog(noTestsModel, emptyReasonerOutput(), r), r).base).toBe(0);
      expect(calculateMutationResilience(noTestsModel, emptyReasonerOutput(), r).base).toBe(0);
      expect(calculateCriticalityWeighting(noTestsModel, emptyReasonerOutput(), r).base).toBe(0);
    });
  });

  describe('final score clamping', () => {
    it('final score is clamped 0-100', () => {
      const model: CodeModel = {
        modules: [
          {
            filePath: '/src/item.service.ts',
            classes: [
              {
                name: 'ItemService',
                type: 'service',
                methods: [{ name: 'getAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 }],
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
              filePath: '/test/item.spec.ts',
              describes: [
                {
                  name: 'ItemService',
                  tests: [
                    { name: 't', targetMethod: 'getAll', assertions: [{ type: 'value_check', target: 'r', matcherUsed: 'toBeDefined' }], mocks: [], isAsync: false, targetClass: 'ItemService' },
                  ],
                },
              ],
            },
          ],
          coverage: { '/src/item.service.ts:ItemService.getAll': ['t'] },
        },
      };

      const extremeNegative: ReasonerOutput = {
        discoveredStates: [],
        assertionJudgments: [
          { testName: 't', quality: 'weak', reasoning: 'x', confidence: 1 },
        ],
        criticalityRatings: [],
        transitiveInferences: [],
      };

      const score = calculateAssertionQuality(model, extremeNegative, resolvedFor(model));
      expect(score.final).toBeGreaterThanOrEqual(0);
      expect(score.final).toBeLessThanOrEqual(100);
    });
  });
});
