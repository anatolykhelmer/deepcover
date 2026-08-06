import { MockLLMProvider } from '../providers/mock';
import {
  DiscoveredStateSchema,
  AssertionJudgmentSchema,
  CriticalityRatingSchema,
  TransitiveInferenceSchema,
} from '../types';
import { buildDomainStatesPrompt } from '../prompts/domain-states';
import { buildAssertionQualityPrompt } from '../prompts/assertion-quality';
import { buildCriticalityPrompt } from '../prompts/criticality';
import { buildTransitiveCoveragePrompt } from '../prompts/transitive-coverage';
import type { ClassNode, TestFileNode, DependencyEdge, TestInventory } from '../../types/code-model';

const minimalClassNode: ClassNode = {
  name: 'ItemService',
  type: 'service',
  methods: [
    { name: 'findAll', visibility: 'public', params: [], returnType: 'Item[]', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
    { name: 'create', visibility: 'public', params: [], returnType: 'Item', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 1 },
  ],
  dependencies: [],
  states: [],
};

const minimalTestFileNode: TestFileNode = {
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
};

const minimalTestInventory: TestInventory = {
  testFiles: [minimalTestFileNode],
  coverage: { findAll: ['should return items'], create: ['should create item'] },
};

const edges: DependencyEdge[] = [
  { from: 'OrderController', to: 'OrderService', type: 'injection' },
  { from: 'OrderService', to: 'PaymentGateway', type: 'injection' },
];

describe('MockLLMProvider', () => {
  const provider = new MockLLMProvider();

  describe('domain states prompt', () => {
    it('returns valid JSON for domain states prompt', async () => {
      const { system, user } = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      expect(() => JSON.parse(response)).not.toThrow();
      const parsed = JSON.parse(response);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('domain states response passes Zod validation', async () => {
      const { system, user } = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as unknown[];
      for (const item of parsed) {
        expect(() => DiscoveredStateSchema.parse(item)).not.toThrow();
      }
    });

    it('returns realistic data for findAll and create methods', async () => {
      const { system, user } = buildDomainStatesPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as Array<{ className: string; methodName: string }>;
      const methodNames = parsed.map((p) => p.methodName);
      expect(methodNames).toContain('findAll');
      expect(methodNames).toContain('create');
    });
  });

  describe('assertion quality prompt', () => {
    it('returns valid JSON for assertion quality prompt', async () => {
      const { system, user } = buildAssertionQualityPrompt({ testFiles: [minimalTestFileNode] });
      const response = await provider.analyze(system, user);
      expect(() => JSON.parse(response)).not.toThrow();
      const parsed = JSON.parse(response);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('assertion quality response passes Zod validation', async () => {
      const { system, user } = buildAssertionQualityPrompt({ testFiles: [minimalTestFileNode] });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as unknown[];
      for (const item of parsed) {
        expect(() => AssertionJudgmentSchema.parse(item)).not.toThrow();
      }
    });
  });

  describe('criticality prompt', () => {
    it('returns valid JSON for criticality prompt', async () => {
      const { system, user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      expect(() => JSON.parse(response)).not.toThrow();
      const parsed = JSON.parse(response);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('criticality response passes Zod validation', async () => {
      const { system, user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as unknown[];
      for (const item of parsed) {
        expect(() => CriticalityRatingSchema.parse(item)).not.toThrow();
      }
    });

    it('returns realistic criticality ratings for findAll and create', async () => {
      const { system, user } = buildCriticalityPrompt({ classes: [minimalClassNode] });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as Array<{ methodName: string; criticality: string }>;
      const createItem = parsed.find((p) => p.methodName === 'create');
      const findAllItem = parsed.find((p) => p.methodName === 'findAll');
      expect(createItem?.criticality).toBe('high');
      expect(findAllItem?.criticality).toBe('medium');
    });
  });

  describe('transitive coverage prompt', () => {
    it('returns valid JSON for transitive coverage prompt', async () => {
      const { system, user } = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        testInventory: minimalTestInventory,
      });
      const response = await provider.analyze(system, user);
      expect(() => JSON.parse(response)).not.toThrow();
      const parsed = JSON.parse(response);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('transitive coverage response passes Zod validation', async () => {
      const { system, user } = buildTransitiveCoveragePrompt({
        edges,
        classes: [minimalClassNode],
        testInventory: minimalTestInventory,
      });
      const response = await provider.analyze(system, user);
      const parsed = JSON.parse(response) as unknown[];
      for (const item of parsed) {
        expect(() => TransitiveInferenceSchema.parse(item)).not.toThrow();
      }
    });
  });
});
