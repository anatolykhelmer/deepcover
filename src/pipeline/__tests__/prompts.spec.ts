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

    // ItemService injects and calls Repository, so buildDependedOnByMap should
    // attach `dependedOnBy: ["ItemService"]` to the Repository class — verify
    // that against a build with the graph stripped, not just against a
    // substring of the JSON.
    const withGraph = buildPrompts({ scopedModel });
    const withoutGraph = buildPrompts({ scopedModel: { ...scopedModel, dependencyGraph: [] } });

    expect(withGraph.criticality.user).not.toEqual(withoutGraph.criticality.user);

    const payload = JSON.parse(withGraph.criticality.user) as {
      classes: Array<{ name: string; dependedOnBy?: string[] }>;
    };
    const repository = payload.classes.find((c) => c.name === 'Repository');
    expect(repository?.dependedOnBy).toEqual(['ItemService']);

    const payloadWithoutGraph = JSON.parse(withoutGraph.criticality.user) as {
      classes: Array<{ name: string; dependedOnBy?: string[] }>;
    };
    const repositoryWithoutGraph = payloadWithoutGraph.classes.find((c) => c.name === 'Repository');
    expect(repositoryWithoutGraph?.dependedOnBy).toBeUndefined();
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

  it('deduplicates repeated runtime test names before appending them', () => {
    const model = scopedFixtureModel();
    const staticMap = buildTestsByMethod(model.testInventory);
    const firstMethod = Object.keys(staticMap)[0]!;
    const knownName = staticMap[firstMethod]![0]!;
    const runtimeName = `${knownName} (variant c)`;

    // Two separate Jest test results can carry the identical testName (e.g.
    // re-runs, retries). Runtime names are deduped via a Set before matching,
    // so the method's list must gain exactly one appended entry, not one per
    // occurrence.
    const runtime = {
      testResults: [{ testName: runtimeName }, { testName: runtimeName }],
    } as unknown as JestRuntimeData;

    const enriched = buildTestsByMethod(model.testInventory, runtime);
    const occurrences = enriched[firstMethod]!.filter((name) => name === runtimeName);
    expect(occurrences).toHaveLength(1);
  });
});
