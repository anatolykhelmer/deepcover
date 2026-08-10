import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import { resolveCoverage } from '../../resolver';
import { calculateAssertionQuality } from '../assertion-quality';
import { calculateStateCoverage } from '../state-coverage';
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
          coverage: { 'ItemService.getAll': ['weak', 'weak2'] },
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
          coverage: { 'ItemService.getAll': ['strong', 'strong2'] },
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
          coverage: { 'ItemService.getAll': ['t'] },
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
    it('no discoveredStates = not applicable', () => {
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

      const score = calculateStateCoverage(model, emptyReasonerOutput(), resolvedFor(model));
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
        testInventory: { testFiles: [], coverage: {} },
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

      const score = calculateStateCoverage(model, reasoner, resolvedFor(model));
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
        testInventory: { testFiles: [], coverage: {} },
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

      const allScore = calculateStateCoverage(model, allTested, resolvedFor(model));
      const halfScore = calculateStateCoverage(model, halfTested, resolvedFor(model));
      expect(halfScore.base).toBeLessThan(allScore.base);
      expect(halfScore.applicable).toBe(true);
      expect(allScore.applicable).toBe(true);
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
          coverage: { 'ItemService.lowComplex': ['t'] },
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
          coverage: { 'S.get': ['t'] },
        },
      };
      const empty = emptyReasonerOutput();
      const r = resolvedFor(model);
      expect(calculateAssertionQuality(model, empty, r).final).toBe(calculateAssertionQuality(model, empty, r).base);
      expect(calculateStateCoverage(model, empty, r).final).toBe(calculateStateCoverage(model, empty, r).base);
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
      expect(calculateStateCoverage(noTestsModel, emptyReasonerOutput(), r).base).toBe(0);
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
          coverage: { 'ItemService.getAll': ['t'] },
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
