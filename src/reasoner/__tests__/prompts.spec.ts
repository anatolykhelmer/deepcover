import {
  ReasonerOutputSchema,
  DiscoveredStateSchema,
  AssertionJudgmentSchema,
  CriticalityRatingSchema,
  TransitiveInferenceSchema,
} from '../types';
import { buildDomainStatesPrompt } from '../prompts/domain-states';
import { buildAssertionQualityPrompt } from '../prompts/assertion-quality';
import { buildCriticalityPrompt } from '../prompts/criticality';
import { buildTransitiveCoveragePrompt } from '../prompts/transitive-coverage';
import { buildBugFindingPrompt } from '../prompts/bug-finding';
import type { ClassNode, TestFileNode, DependencyEdge, TestInventory } from '../../types/code-model';

const minimalClassNode: ClassNode = {
  name: 'FooService',
  type: 'service',
  methods: [
    {
      name: 'getById',
      visibility: 'public',
      params: [],
      returnType: 'Promise<Item>',
      branches: [],
      branchCount: 0,
      throwsErrors: false,
      hasAsyncOps: true,
      externalCalls: ['HttpService.get'],
      internalCalls: [],
      startLine: 1,
      endLine: 1,
    },
  ],
  dependencies: ['HttpService'],
  states: [],
};

const minimalTestFileNode: TestFileNode = {
  filePath: '/test/foo.spec.ts',
  describes: [
    {
      name: 'FooService',
      tests: [
        {
          name: 'should return item',
          targetMethod: 'getById',
          assertions: [{ type: 'value_check', target: 'result', matcherUsed: 'toEqual' }],
          mocks: [],
          isAsync: true,
        },
      ],
    },
  ],
};

const minimalTestInventory: TestInventory = {
  testFiles: [minimalTestFileNode],
  coverage: { getById: ['should return item'] },
};

const standaloneFunctions = [
  {
    filePath: '/src/http-error-formatter.ts',
    functions: [
      {
        name: 'buildFormattedValidationErrors',
        visibility: 'public' as const,
        params: [
          { name: 'errors', type: 'ValidationError[]', isOptional: false },
        ],
        returnType: 'string[]',
        branches: [{ type: 'if' as const, condition: 'errors.length === 0', lineNumber: 10 }],
        branchCount: 1,
        throwsErrors: false,
        hasAsyncOps: false,
        externalCalls: [],
        internalCalls: [],
        startLine: 8,
        endLine: 18,
      },
    ],
  },
];

describe('Reasoner prompt templates', () => {
  describe('buildDomainStatesPrompt', () => {
    it('returns { system, user }', () => {
      const result = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(typeof result.system).toBe('string');
      expect(typeof result.user).toBe('string');
    });

    it('system prompt contains JSON format and confidence instructions', () => {
      const { system } = buildDomainStatesPrompt({ classes: [] });
      expect(system).toMatch(/JSON/i);
      expect(system).toMatch(/confidence/i);
      expect(system).toMatch(/0.*1|0 and 1/);
    });

    it('user prompt contains serialized class data', () => {
      const { user } = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      expect(user).toContain('FooService');
      expect(user).toContain('getById');
      expect(user).toContain('HttpService');
    });

    it('user prompt does not contain raw source code', () => {
      const { user } = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      expect(user).not.toMatch(/\bfunction\s+\w+|\bconst\s+\w+\s*=|=>\s*\{/);
      expect(() => JSON.parse(user)).not.toThrow();
    });

    it('system prompt contains empty-aggregate pattern guidance', () => {
      const { system } = buildDomainStatesPrompt({ classes: [] });
      expect(system).toContain('all items filtered');
      expect(system).toContain('empty aggregate');
    });

    it('serializes standalone functions when provided', () => {
      const { user } = buildDomainStatesPrompt({ classes: [], standaloneFunctions });
      expect(user).toContain('buildFormattedValidationErrors');
      expect(user).toContain('http-error-formatter.ts');
    });
  });

  describe('buildAssertionQualityPrompt', () => {
    it('returns { system, user }', () => {
      const result = buildAssertionQualityPrompt({ testFiles: [minimalTestFileNode] });
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(typeof result.system).toBe('string');
      expect(typeof result.user).toBe('string');
    });

    it('system prompt contains JSON format and confidence instructions', () => {
      const { system } = buildAssertionQualityPrompt({ testFiles: [] });
      expect(system).toMatch(/JSON/i);
      expect(system).toMatch(/confidence/i);
      expect(system).toMatch(/0.*1|0 and 1/);
    });

    it('user prompt contains serialized test data', () => {
      const { user } = buildAssertionQualityPrompt({ testFiles: [minimalTestFileNode] });
      expect(user).toContain('should return item');
      expect(user).toContain('getById');
      expect(user).toContain('toEqual');
    });

    it('user prompt does not contain raw source code', () => {
      const { user } = buildAssertionQualityPrompt({ testFiles: [minimalTestFileNode] });
      expect(user).not.toMatch(/expect\s*\(|\.toBe\s*\(|\.toEqual\s*\(|it\s*\(|describe\s*\(/);
      expect(() => JSON.parse(user)).not.toThrow();
    });

    it('includes standalone function metadata in test context', () => {
      const { user } = buildAssertionQualityPrompt({
        testFiles: [minimalTestFileNode],
        classes: [],
        standaloneFunctions,
      });
      expect(user).toContain('buildFormattedValidationErrors');
      expect(user).toContain('branchCount');
    });
  });

  describe('buildCriticalityPrompt', () => {
    it('returns { system, user }', () => {
      const result = buildCriticalityPrompt({ classes: [minimalClassNode] });
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(typeof result.system).toBe('string');
      expect(typeof result.user).toBe('string');
    });

    it('system prompt contains JSON format and confidence instructions', () => {
      const { system } = buildCriticalityPrompt({ classes: [] });
      expect(system).toMatch(/JSON/i);
      expect(system).toMatch(/confidence/i);
      expect(system).toMatch(/0.*1|0 and 1/);
    });

    it('user prompt contains serialized class/method data', () => {
      const { user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      expect(user).toContain('FooService');
      expect(user).toContain('getById');
    });

    it('user prompt does not contain raw source code', () => {
      const { user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      expect(user).not.toMatch(/\bfunction\s+\w+|\bconst\s+\w+\s*=|=>\s*\{/);
      expect(() => JSON.parse(user)).not.toThrow();
    });

    it('includes Istanbul coverage data when provided', () => {
      const istanbulCoverage = new Map([
        ['FooService.getById', { lineCoveragePercent: 85.7, branchCoveragePercent: 66.6 }],
      ]);
      const { user } = buildCriticalityPrompt({ classes: [minimalClassNode], istanbulCoverage });
      const parsed = JSON.parse(user);
      expect(parsed.classes[0].methods[0].lineCoveragePercent).toBe(86);
      expect(parsed.classes[0].methods[0].branchCoveragePercent).toBe(67);
    });

    it('omits coverage fields when Istanbul data is not provided', () => {
      const { user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      const parsed = JSON.parse(user);
      expect(parsed.classes[0].methods[0]).not.toHaveProperty('lineCoveragePercent');
      expect(parsed.classes[0].methods[0]).not.toHaveProperty('branchCoveragePercent');
    });

    it('system prompt references Istanbul coverage', () => {
      const { system } = buildCriticalityPrompt({ classes: [] });
      expect(system).toContain('Istanbul');
      expect(system).toContain('lineCoveragePercent');
    });

    it('includes standalone functions in serialized payload', () => {
      const { user } = buildCriticalityPrompt({ classes: [], standaloneFunctions });
      expect(user).toContain('buildFormattedValidationErrors');
      expect(user).toContain('/src/http-error-formatter.ts');
    });
  });

  describe('buildTransitiveCoveragePrompt', () => {
    const edges: DependencyEdge[] = [
      { from: 'Controller', to: 'Service', type: 'injection' },
      { from: 'Service', to: 'Gateway', type: 'injection' },
    ];

    it('returns { system, user }', () => {
      const result = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        testInventory: minimalTestInventory,
      });
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(typeof result.system).toBe('string');
      expect(typeof result.user).toBe('string');
    });

    it('system prompt contains JSON format and confidence instructions', () => {
      const { system } = buildTransitiveCoveragePrompt({
        edges: [],
        classes: [],
        testInventory: minimalTestInventory,
      });
      expect(system).toMatch(/JSON/i);
      expect(system).toMatch(/confidence/i);
      expect(system).toMatch(/0.*1|0 and 1/);
    });

    it('user prompt contains serialized graph, classes, and coverage data', () => {
      const { user } = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        testInventory: minimalTestInventory,
      });
      expect(user).toContain('Controller');
      expect(user).toContain('Service');
      expect(user).toContain('FooService');
      expect(user).toContain('getById');
      expect(user).toContain('should return item');
    });

    it('user prompt does not contain raw source code', () => {
      const { user } = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        testInventory: minimalTestInventory,
      });
      expect(user).not.toMatch(/\bfunction\s+\w+|\bconst\s+\w+\s*=|=>\s*\{/);
      expect(() => JSON.parse(user)).not.toThrow();
    });

    it('includes standalone functions in dependency payload', () => {
      const { user } = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        standaloneFunctions,
        testInventory: minimalTestInventory,
      });
      expect(user).toContain('buildFormattedValidationErrors');
      expect(user).toContain('http-error-formatter.ts');
    });
  });

  describe('buildBugFindingPrompt', () => {
    it('returns system and user prompts', () => {
      const result = buildBugFindingPrompt({
        classes: [
          {
            name: 'OrderService',
            type: 'service',
            methods: [
              {
                name: 'create',
                visibility: 'public',
                params: [],
                returnType: 'Order',
                branches: [],
                branchCount: 0,
                throwsErrors: false,
                hasAsyncOps: false,
                externalCalls: [],
                internalCalls: [],
                startLine: 1,
                endLine: 10,
              },
            ],
            dependencies: [],
            states: [],
          },
        ],
        testFiles: [],
        bugSignals: [],
      });
      expect(result.system).toContain('potential bugs');
      expect(result.user).toBeTruthy();
    });

    it('includes bug signals in user prompt when provided', () => {
      const result = buildBugFindingPrompt({
        classes: [],
        testFiles: [],
        bugSignals: [
          {
            pattern: 'unhandled-error-path',
            className: 'OrderService',
            methodName: 'create',
            evidence: 'catch block at line 15',
            sourceLocation: { file: 'src/order.ts', line: 15 },
            confidence: 0.7,
          },
        ],
      });
      expect(result.user).toContain('unhandled-error-path');
      expect(result.user).toContain('catch block at line 15');
    });
  });
});

describe('ReasonerOutput Zod schemas', () => {
  const validDiscoveredState = {
    className: 'FooService',
    methodName: 'getById',
    state: 'item not found',
    isTested: true,
    riskIfUntested: 'medium' as const,
    confidence: 0.9,
  };

  const validAssertionJudgment = {
    testName: 'should return item',
    quality: 'strong' as const,
    reasoning: 'Uses toEqual for value check',
    confidence: 0.85,
  };

  const validCriticalityRating = {
    className: 'FooService',
    methodName: 'getById',
    criticality: 'high' as const,
    reasoning: 'External HTTP call',
    confidence: 0.9,
  };

  const validTransitiveInference = {
    from: 'Controller',
    through: 'Service',
    to: 'Gateway',
    coveredTransitively: true,
    caveat: null,
    confidence: 0.8,
  };

  it('valid ReasonerOutput passes validation', () => {
    const valid: Parameters<typeof ReasonerOutputSchema.parse>[0] = {
      discoveredStates: [validDiscoveredState],
      assertionJudgments: [validAssertionJudgment],
      criticalityRatings: [validCriticalityRating],
      transitiveInferences: [validTransitiveInference],
    };
    expect(() => ReasonerOutputSchema.parse(valid)).not.toThrow();
    const parsed = ReasonerOutputSchema.parse(valid);
    expect(parsed.discoveredStates).toHaveLength(1);
    expect(parsed.assertionJudgments).toHaveLength(1);
    expect(parsed.criticalityRatings).toHaveLength(1);
    expect(parsed.transitiveInferences).toHaveLength(1);
  });

  it('invalid data (missing fields) fails validation', () => {
    expect(() =>
      DiscoveredStateSchema.parse({
        className: 'Foo',
        methodName: 'bar',
        // missing state, isTested, riskIfUntested, confidence
      })
    ).toThrow();

    expect(() =>
      AssertionJudgmentSchema.parse({
        testName: 'test',
        // missing quality, reasoning, confidence
      })
    ).toThrow();
  });

  it('invalid data (wrong types) fails validation', () => {
    expect(() =>
      DiscoveredStateSchema.parse({
        ...validDiscoveredState,
        confidence: 'high', // should be number
      })
    ).toThrow();

    expect(() =>
      AssertionJudgmentSchema.parse({
        ...validAssertionJudgment,
        quality: 'invalid', // not weak|medium|strong
      })
    ).toThrow();
  });

  it('confidence outside 0-1 range fails', () => {
    expect(() =>
      DiscoveredStateSchema.parse({
        ...validDiscoveredState,
        confidence: 1.5,
      })
    ).toThrow();

    expect(() =>
      DiscoveredStateSchema.parse({
        ...validDiscoveredState,
        confidence: -0.1,
      })
    ).toThrow();

    expect(() =>
      CriticalityRatingSchema.parse({
        ...validCriticalityRating,
        confidence: 2,
      })
    ).toThrow();

    expect(() =>
      TransitiveInferenceSchema.parse({
        ...validTransitiveInference,
        confidence: -1,
      })
    ).toThrow();
  });

  it('valid confidence at boundaries passes', () => {
    expect(() =>
      DiscoveredStateSchema.parse({ ...validDiscoveredState, confidence: 0 })
    ).not.toThrow();
    expect(() =>
      DiscoveredStateSchema.parse({ ...validDiscoveredState, confidence: 1 })
    ).not.toThrow();
  });
});
