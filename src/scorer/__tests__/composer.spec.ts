import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
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
                { name: 't1', targetMethod: 'getAll', assertions: [], mocks: [], isAsync: false },
              ],
            },
          ],
        },
      ],
      coverage: { getAll: ['t1'], getById: [] },
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
});
