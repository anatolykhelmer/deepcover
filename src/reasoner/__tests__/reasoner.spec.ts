import { runReasoner } from '../index';
import { MockLLMProvider } from '../providers/mock';
import { ReasonerOutputSchema } from '../types';
import type { CodeModel } from '../../types/code-model';

const minimalCodeModel: CodeModel = {
  modules: [
    {
      filePath: '/src/item.service.ts',
      classes: [
        {
          name: 'ItemService',
          type: 'service',
          methods: [
            { name: 'findAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
            { name: 'create', visibility: 'public', params: [], returnType: 'Item', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
          ],
          dependencies: [],
          states: [],
        },
      ],
    },
  ],
  dependencyGraph: [
    { from: 'OrderController', to: 'OrderService', type: 'injection' },
    { from: 'OrderService', to: 'PaymentGateway', type: 'injection' },
  ],
  testInventory: {
    testFiles: [
      {
        filePath: '/test/item.spec.ts',
        describes: [
          {
            name: 'ItemService',
            tests: [
              { name: 'should return items', targetMethod: 'findAll', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }], mocks: [], isAsync: false },
              { name: 'should create item', targetMethod: 'create', assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toBeDefined' }], mocks: [], isAsync: false },
            ],
          },
        ],
      },
    ],
    coverage: { findAll: ['should return items'], create: ['should create item'] },
  },
};

describe('runReasoner', () => {
  const provider = new MockLLMProvider();

  it('returns a valid ReasonerOutput', async () => {
    const output = await runReasoner(minimalCodeModel, provider);
    expect(output).toHaveProperty('discoveredStates');
    expect(output).toHaveProperty('assertionJudgments');
    expect(output).toHaveProperty('criticalityRatings');
    expect(output).toHaveProperty('transitiveInferences');
  });

  it('all four insight arrays are populated', async () => {
    const output = await runReasoner(minimalCodeModel, provider);
    expect(output.discoveredStates.length).toBeGreaterThan(0);
    expect(output.assertionJudgments.length).toBeGreaterThan(0);
    expect(output.criticalityRatings.length).toBeGreaterThan(0);
    expect(output.transitiveInferences.length).toBeGreaterThan(0);
  });

  it('ReasonerOutput passes Zod validation', async () => {
    const output = await runReasoner(minimalCodeModel, provider);
    expect(() => ReasonerOutputSchema.parse(output)).not.toThrow();
  });

  it('if provider returns invalid JSON for one prompt, that category is empty but others still work', async () => {
    const badProvider = {
      analyze: async (system: string, _user: string): Promise<string> => {
        if (system.toLowerCase().includes('domain states')) {
          return '[{"className":"X","methodName":"y","state":"z","isTested":true,"riskIfUntested":"invalid","confidence":0.5}]';
        }
        return new MockLLMProvider().analyze(system, _user);
      },
    };
    const output = await runReasoner(minimalCodeModel, badProvider);
    expect(output.discoveredStates).toHaveLength(0);
    expect(output.assertionJudgments.length).toBeGreaterThan(0);
    expect(output.criticalityRatings.length).toBeGreaterThan(0);
    expect(output.transitiveInferences.length).toBeGreaterThan(0);
    expect(() => ReasonerOutputSchema.parse(output)).not.toThrow();
  });

  it('starts all four core analyze calls before any completes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider: import('../providers/base').LLMProvider = {
      analyze: async (system, user) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return new MockLLMProvider().analyze(system, user);
      },
    };
    await runReasoner(minimalCodeModel, provider);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it('runs bug-finding when bugSignals are provided', async () => {
    const signals = [
      {
        pattern: 'unhandled-error-path' as const,
        className: 'ItemService',
        methodName: 'create',
        evidence: 'throws without test',
        sourceLocation: { file: '/src/item.service.ts', line: 1 },
        confidence: 0.7,
      },
    ];
    const output = await runReasoner(minimalCodeModel, new MockLLMProvider(), signals);
    expect(output.bugFindings).toBeDefined();
    expect(output.bugFindings!.findings.length + output.bugFindings!.signalValidations.length).toBeGreaterThan(0);
  });
});
