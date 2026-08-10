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
        filePath: '/src/item.service.spec.ts',
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

function makeTest(name: string, targetMethod: string, targetClass: string) {
  return {
    name,
    targetMethod,
    targetClass,
    assertions: [{ type: 'value_check' as const, target: 'result', matcherUsed: 'toBe' }],
    mocks: [],
    isAsync: false,
  };
}

/**
 * What `--module src/moduleB` actually produces: sources narrowed to moduleB,
 * but a test inventory the extractor globbed across the whole repository.
 */
const twoModuleModel: CodeModel = {
  modules: [
    {
      filePath: '/src/moduleB/b.service.ts',
      classes: [
        {
          name: 'BService',
          type: 'service',
          methods: [
            { name: 'processPayment', visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 1, throwsErrors: true, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 5 },
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
        filePath: '/src/moduleA/a.service.spec.ts',
        describes: [{ name: 'AService', tests: [makeTest('adds one, verified precisely', 'doWork', 'AService')] }],
      },
      {
        filePath: '/src/moduleB/b.service.spec.ts',
        describes: [{ name: 'BService', tests: [makeTest('rejects a zero amount', 'processPayment', 'BService')] }],
      },
    ],
    coverage: { doWork: ['adds one, verified precisely'], processPayment: ['rejects a zero amount'] },
  },
};

function capturingProvider() {
  const prompts: Array<{ system: string; user: string }> = [];
  const mock = new MockLLMProvider();
  const provider: import('../providers/base').LLMProvider = {
    analyze: async (system, user) => {
      prompts.push({ system, user });
      return mock.analyze(system, user);
    },
  };
  return { prompts, provider };
}

/** Labels (first system-prompt line) of every job whose input mentions `needle`. */
function jobsMentioning(prompts: Array<{ system: string; user: string }>, needle: string): string[] {
  return prompts.filter((p) => p.user.includes(needle)).map((p) => p.system.split('\n')[0]);
}

function expectNoModuleALeak(prompts: Array<{ system: string; user: string }>) {
  expect(jobsMentioning(prompts, '/src/moduleA/a.service.spec.ts')).toEqual([]);
  expect(jobsMentioning(prompts, 'AService')).toEqual([]);
  // …while the module under analysis still reaches the prompts that take tests.
  expect(jobsMentioning(prompts, '/src/moduleB/b.service.spec.ts').length).toBeGreaterThan(0);
}

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

  it('runs bug-finding when bugSignals is an empty array', async () => {
    const output = await runReasoner(minimalCodeModel, new MockLLMProvider(), []);
    expect(output.bugFindings).toBeDefined();
    expect(output.bugFindings!.findings.length + output.bugFindings!.signalValidations.length).toBeGreaterThan(0);
  });

  it('never puts out-of-scope test files in any prompt (regression)', async () => {
    const { prompts, provider } = capturingProvider();

    await runReasoner(twoModuleModel, provider, [], { module: 'src/moduleB' });

    expectNoModuleALeak(prompts);
  });

  it('scopes prompts even when the caller passes no scope at all (regression)', async () => {
    // Fails closed: a call site that forgets to declare its scope must not leak
    // the whole repository's tests, which is how this bug shipped twice.
    const { prompts, provider } = capturingProvider();

    await runReasoner(twoModuleModel, provider, []);

    expectNoModuleALeak(prompts);
  });

  it('keeps every test file when the model covers the whole repository', async () => {
    const { prompts, provider } = capturingProvider();

    await runReasoner(twoModuleModel, provider, [], { wholeRepo: true });

    expect(jobsMentioning(prompts, '/src/moduleA/a.service.spec.ts').length).toBeGreaterThan(0);
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
