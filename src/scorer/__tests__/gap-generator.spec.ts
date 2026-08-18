import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import { resolveCoverage } from '../../resolver';
import { generateGaps } from '../gap-generator';
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
      testInventory: { testFiles: [], coverage: { '/src/s.ts:WebhooksService.getAll': ['t1'] } },
    };
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, emptyReasonerOutput(), resolved, buildStateCatalog(model, emptyReasonerOutput(), resolved));
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
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, emptyReasonerOutput(), resolved, buildStateCatalog(model, emptyReasonerOutput(), resolved));
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
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, emptyReasonerOutput(), resolved, buildStateCatalog(model, emptyReasonerOutput(), resolved));
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
      testInventory: { testFiles: [], coverage: { '/src/s.ts:OrderService.process': ['t1'] } },
    };
    const reasoner: ReasonerOutput = {
      discoveredStates: [
        { className: 'OrderService', methodName: 'process', state: 'when payment fails', isTested: false, riskIfUntested: 'high', confidence: 0.9 },
      ],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
    };
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, reasoner, resolved, buildStateCatalog(model, reasoner, resolved));
    expect(gaps.some((g) => g.scenario.includes('when payment fails') || g.scenario.includes('payment fails'))).toBe(true);
  });

  it('static untested states produce one gap per affected uncovered method', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'OrderService',
              type: 'service',
              methods: [
                // branchCount 5 → high method risk for both
                { name: 'submit', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 5, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
                { name: 'cancel', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 5, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
              ],
              dependencies: [],
              states: [{ source: 'enum', name: 'OrderStatus', values: ['PENDING', 'PAID'], affectedMethods: ['submit', 'cancel'] }],
            },
          ],
        },
      ],
      dependencyGraph: [],
      // submit covered, cancel not
      testInventory: { testFiles: [], coverage: { '/src/s.ts:OrderService.submit': ['t1'] } },
    };
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, emptyReasonerOutput(), resolved, buildStateCatalog(model, emptyReasonerOutput(), resolved));

    const stateGaps = gaps.filter((g) => g.scenario === 'OrderStatus');
    expect(stateGaps).toHaveLength(1); // submit's entry is tested → no gap for it
    expect(stateGaps[0].methodName).toBe('cancel');
    expect(stateGaps[0].risk).toBe('high');
  });

  it('a static state on a low-risk method produces no gap', () => {
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
              states: [{ source: 'enum', name: 'Mode', values: ['ON'], affectedMethods: ['m1'] }],
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: {} },
    };
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, emptyReasonerOutput(), resolved, buildStateCatalog(model, emptyReasonerOutput(), resolved));
    expect(gaps.some((g) => g.scenario === 'Mode')).toBe(false);
  });

  it('a state found by both sources yields one gap, not two', () => {
    const model: CodeModel = {
      modules: [
        {
          filePath: '/src/s.ts',
          classes: [
            {
              name: 'S',
              type: 'service',
              methods: [
                { name: 'm1', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 5, throwsErrors: false, hasAsyncOps: false, externalCalls: ['http'], internalCalls: [], startLine: 1, endLine: 1 },
              ],
              dependencies: [],
              states: [{ source: 'enum', name: 'declined', values: ['soft'], affectedMethods: ['m1'] }],
            },
          ],
        },
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: {} },
    };
    const reasoner: ReasonerOutput = {
      ...emptyReasonerOutput(),
      discoveredStates: [
        { className: 'S', methodName: 'm1', state: 'Declined', isTested: false, riskIfUntested: 'high', confidence: 0.9 },
      ],
    };
    const resolved = resolvedFor(model);
    const gaps = generateGaps(model, reasoner, resolved, buildStateCatalog(model, reasoner, resolved));

    const declinedGaps = gaps.filter((g) => g.scenario.toLowerCase() === 'declined');
    expect(declinedGaps).toHaveLength(1);
    expect(declinedGaps[0].risk).toBe('high'); // riskIfUntested wins for merged entries
  });
});
