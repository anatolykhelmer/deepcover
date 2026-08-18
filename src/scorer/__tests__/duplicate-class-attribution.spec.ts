import type { CodeModel } from '../../types/code-model';
import type { ReasonerOutput } from '../../reasoner/types';
import type { MethodCoverage, ResolvedCoverage } from '../../resolver/types';
import { classMethodKey } from '../../types/method-owner';
import { calculateStateCoverage } from '../state-coverage';
import { buildStateCatalog } from '../state-catalog';
import { calculateCriticalityWeighting } from '../criticality';

/**
 * Reasoner output names a class, never the file that declares it. When two files
 * declare the same class name the rating cannot be attributed to either, and an
 * unattributable judgment must be dropped — not silently scored against a
 * default. Both call sites used to look up by bare class name, which returns
 * nothing on a duplicate and then reads that nothing as "no Istanbul data"
 * (full credit) or "untested" (a penalty).
 */

function coverageEntry(
  filePath: string,
  className: string,
  methodName: string,
  overrides: Partial<MethodCoverage> = {},
): MethodCoverage {
  return {
    className,
    methodName,
    qualifiedName: `${className}.${methodName}`,
    filePath,
    staticTests: [],
    isCovered: false,
    coverageSource: 'static',
    ...overrides,
  };
}

/** Mirrors the resolver's real keying and its fail-closed name-only fallback. */
function resolvedCoverageOf(entries: MethodCoverage[], hasIstanbulData: boolean): ResolvedCoverage {
  const methods = new Map<string, MethodCoverage>();
  for (const mc of entries) {
    methods.set(classMethodKey(mc.filePath, mc.className, mc.methodName), mc);
  }
  const byName = new Map<string, MethodCoverage[]>();
  for (const mc of methods.values()) {
    const list = byName.get(mc.qualifiedName);
    if (list) list.push(mc);
    else byName.set(mc.qualifiedName, [mc]);
  }

  const lookup = (className: string, methodName: string, filePath?: string): MethodCoverage | undefined => {
    if (filePath !== undefined) {
      const byFile = methods.get(classMethodKey(filePath, className, methodName));
      if (byFile) return byFile;
    }
    const candidates = byName.get(`${className}.${methodName}`);
    return candidates && candidates.length === 1 ? candidates[0] : undefined;
  };

  return {
    methods,
    hasIstanbulData,
    hasRuntimeData: false,
    isMethodCovered: (c, m, f) => lookup(c, m, f)?.isCovered ?? false,
    getMethodCoverage: (c, m, f) => lookup(c, m, f),
    getTestsForMethod: (c, m, f) => lookup(c, m, f)?.staticTests ?? [],
  };
}

function istanbul(linePct: number, branchPct: number, branchesHit: number, branchesTotal: number) {
  return {
    linesCovered: 1,
    linesTotal: 1,
    lineCoveragePercent: linePct,
    branchesHit,
    branchesTotal,
    branchCoveragePercent: branchPct,
    binaryExpressions: [],
  };
}

function reasonerOutput(overrides: Partial<ReasonerOutput> = {}): ReasonerOutput {
  return {
    discoveredStates: [],
    assertionJudgments: [],
    criticalityRatings: [],
    transitiveInferences: [],
    ...overrides,
  };
}

function classModule(filePath: string, className: string, methodName: string): CodeModel['modules'][number] {
  return {
    filePath,
    classes: [{
      name: className, type: 'service',
      methods: [{ name: methodName, visibility: 'public', params: [], returnType: 'void', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 5 }],
      dependencies: [], states: [],
    }],
  };
}

describe('state coverage with a duplicated class name', () => {
  it('drops a state it cannot attribute instead of scoring it at full branch scale', () => {
    const resolved = resolvedCoverageOf([
      coverageEntry('src/a/order.ts', 'OrderService', 'process', {
        isCovered: true, coverageSource: 'istanbul', istanbul: istanbul(100, 40, 2, 5),
      }),
      coverageEntry('src/b/order.ts', 'OrderService', 'process', {
        isCovered: true, coverageSource: 'istanbul', istanbul: istanbul(100, 100, 5, 5),
      }),
      coverageEntry('src/item.ts', 'ItemService', 'getAll', {
        isCovered: true, coverageSource: 'istanbul', istanbul: istanbul(100, 50, 5, 10),
      }),
    ], true);

    const output = reasonerOutput({
      discoveredStates: [
        { className: 'OrderService', methodName: 'process', state: 'pending', isTested: true, riskIfUntested: 'high', confidence: 1 },
        { className: 'ItemService', methodName: 'getAll', state: 'empty', isTested: true, riskIfUntested: 'low', confidence: 1 },
      ],
    });

    const model: CodeModel = {
      modules: [
        classModule('src/a/order.ts', 'OrderService', 'process'),
        classModule('src/b/order.ts', 'OrderService', 'process'),
        classModule('src/item.ts', 'ItemService', 'getAll'),
      ],
      dependencyGraph: [],
      testInventory: { testFiles: [], coverage: {} },
    };

    const score = calculateStateCoverage(buildStateCatalog(model, output, resolved), resolved);

    // Only ItemService.getAll is attributable, and it sits at 50% branch scale.
    // Counting the unattributable OrderService state at scale 1 would read as 75.
    expect(score.base).toBeCloseTo(50, 5);
  });
});

describe('criticality weighting with a duplicated class name', () => {
  const codeModel: CodeModel = {
    modules: [
      {
        filePath: 'src/a/payment.ts',
        classes: [{
          name: 'PaymentService', type: 'service',
          methods: [{ name: 'charge', visibility: 'public', params: [], returnType: 'Receipt', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 5 }],
          dependencies: [], states: [],
        }],
      },
      {
        filePath: 'src/b/payment.ts',
        classes: [{
          name: 'PaymentService', type: 'service',
          methods: [{ name: 'charge', visibility: 'public', params: [], returnType: 'Receipt', branches: [], branchCount: 0, throwsErrors: false, hasAsyncOps: false, externalCalls: [], internalCalls: [], startLine: 1, endLine: 5 }],
          dependencies: [], states: [],
        }],
      },
    ],
    dependencyGraph: [],
    testInventory: { testFiles: [], coverage: {} },
  };

  it('does not penalise a high-criticality rating it cannot attribute to a file', () => {
    const resolved = resolvedCoverageOf([
      coverageEntry('src/a/payment.ts', 'PaymentService', 'charge', { isCovered: true, staticTests: ['charges the card'] }),
      coverageEntry('src/b/payment.ts', 'PaymentService', 'charge', { isCovered: true, staticTests: ['charges the card'] }),
    ], false);

    const output = reasonerOutput({
      criticalityRatings: [
        { className: 'PaymentService', methodName: 'charge', criticality: 'high', reasoning: 'money', confidence: 1 },
      ],
    });

    const score = calculateCriticalityWeighting(codeModel, output, resolved);

    // Both declarations are covered. Reading the unattributable rating as
    // "high criticality, untested" would subtract 10.
    expect(score.llmAdjustment).toBe(0);
  });
});
