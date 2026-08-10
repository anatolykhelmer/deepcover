import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import { resolveCoverage } from '../../resolver';
import { generateGaps } from '../gap-generator';

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

describe('gap-generator', () => {
  it('untested methods appear in gaps', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'WebhooksService',
              type: 'service',
              methods: [
                { name: 'resend', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                { name: 'getAll', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
              ],
              dependencies: [],
              states: [],
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: { 'WebhooksService.getAll': ['t1'] } },
    };
    const gaps = generateGaps(model, emptyReasonerOutput(), resolvedFor(model));
    expect(gaps.some((g) => g.methodName === 'resend')).toBe(true);
    expect(gaps.some((g) => g.methodName === 'getAll')).toBe(false);
  });

  it('gaps sorted by risk (high first)', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'S',
              type: 'service',
              methods: [
                { name: 'low', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                { name: 'high', visibility: 'public', params: [], returnType: 'void', branches: [{ type: 'if', condition: 'x', lineNumber: 1 }], branchCount: 5, throwsErrors: false, hasAsyncOps: false, externalCalls: ['http'], internalCalls: [], startLine: 1, endLine: 1 },
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
    const gaps = generateGaps(model, emptyReasonerOutput(), resolvedFor(model));
    const riskOrder = ['high', 'medium', 'low'];
    for (let i = 1; i < gaps.length; i++) {
      const prevIdx = riskOrder.indexOf(gaps[i - 1].risk);
      const currIdx = riskOrder.indexOf(gaps[i].risk);
      expect(prevIdx).toBeLessThanOrEqual(currIdx);
    }
  });

  it('each gap has suggestedTest', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'WebhooksService',
              type: 'service',
              methods: [
                { name: 'resend', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
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
    const gaps = generateGaps(model, emptyReasonerOutput(), resolvedFor(model));
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => typeof g.suggestedTest === 'string' && g.suggestedTest.length > 0)).toBe(true);
  });

  it('LLM-discovered untested states appear as gaps', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'OrderService',
              type: 'service',
              methods: [
                { name: 'process', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
              ],
              dependencies: [],
              states: [],
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: { 'OrderService.process': ['t1'] } },
    };
    const reasoner: ReasonerOutput = {
      discoveredStates: [
        { className: 'OrderService', methodName: 'process', state: 'when payment fails', isTested: false, riskIfUntested: 'high', confidence: 0.9 },
      ],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
    };
    const gaps = generateGaps(model, reasoner, resolvedFor(model));
    expect(gaps.some((g) => g.scenario.includes('when payment fails') || g.scenario.includes('payment fails'))).toBe(true);
  });
});
