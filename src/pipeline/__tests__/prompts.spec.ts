import path from 'path';
import { extractCodeModel } from '../../extractor';
import { scopeModelForReasoner } from '../../reasoner/scope';
import { buildPrompts, buildTestsByMethod } from '../prompts';
import type { JestRuntimeData } from '../../resolver/types';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = 'fixtures/assertion-quality';

function scopedFixtureModel() {
  const codeModel = extractCodeModel({
    rootDir: PROJECT_ROOT,
    include: [`${FIXTURE}/**/*.ts`],
  });
  return scopeModelForReasoner(codeModel, { module: FIXTURE });
}

describe('buildPrompts', () => {
  it('builds the four base prompts and omits bugFinding without signals', () => {
    const prompts = buildPrompts({ scopedModel: scopedFixtureModel() });

    expect(prompts.domainStates.system).toBeTruthy();
    expect(prompts.assertionQuality.system).toBeTruthy();
    expect(prompts.criticality.system).toBeTruthy();
    expect(prompts.transitiveCoverage.system).toBeTruthy();
    expect(prompts.bugFinding).toBeUndefined();
  });

  it('adds the bug-finding prompt when signals are supplied', () => {
    const prompts = buildPrompts({
      scopedModel: scopedFixtureModel(),
      bugSignals: [
        {
          pattern: 'unhandled-error-path',
          className: 'ItemService',
          methodName: 'create',
          evidence: 'throws without test',
          sourceLocation: { file: '/src/item.service.ts', line: 1 },
          confidence: 0.7,
        },
      ],
    });

    expect(prompts.bugFinding).toBeDefined();
    expect(prompts.bugFinding!.user).toContain('unhandled-error-path');
  });

  it('feeds the dependency graph into the criticality prompt', () => {
    const scopedModel = scopedFixtureModel();
    const prompts = buildPrompts({ scopedModel });
    const payload = JSON.parse(prompts.criticality.user) as Record<string, unknown>;

    expect(payload).toHaveProperty('classes');
    expect(JSON.stringify(payload)).toContain('ItemService');
  });

  it('is deterministic — the same scoped model yields identical prompts', () => {
    const model = scopedFixtureModel();
    expect(buildPrompts({ scopedModel: model })).toEqual(buildPrompts({ scopedModel: model }));
  });
});

describe('buildTestsByMethod', () => {
  it('maps target methods to their test names', () => {
    const model = scopedFixtureModel();
    const map = buildTestsByMethod(model.testInventory);

    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const names of Object.values(map)) {
      expect(names.length).toBeGreaterThan(0);
    }
  });

  it('enriches with runtime test names that contain a known static name', () => {
    const model = scopedFixtureModel();
    const staticMap = buildTestsByMethod(model.testInventory);
    const firstMethod = Object.keys(staticMap)[0]!;
    const knownName = staticMap[firstMethod]![0]!;

    const runtime = {
      testResults: [{ testName: `${knownName} (variant b)` }],
    } as unknown as JestRuntimeData;

    const enriched = buildTestsByMethod(model.testInventory, runtime);
    expect(enriched[firstMethod]).toContain(`${knownName} (variant b)`);
  });
});
