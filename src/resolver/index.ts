import path from 'path';
import type { CodeModel } from '../types/code-model';
import type {
  CoverageProviderId,
  IstanbulCoverageData,
  RuntimeData,
  MethodCoverage,
  ResolvedCoverage,
} from './types';
import { mapIstanbulToMethod } from './istanbul-mapper';
import { matchRuntimeTests } from './runtime-matcher';
import { buildClassMethodOwners, classMethodKey } from '../types/method-owner';
import { allCallables, calleeKey, functionCoverageKey } from '../types/callable';

export { resolveCoverage };
export type { ResolvedCoverage, MethodCoverage } from './types';

function resolveCoverage(
  codeModel: CodeModel,
  rootDir: string,
  runtimeData?: {
    istanbul?: IstanbulCoverageData;
    runtime?: RuntimeData;
  }
): ResolvedCoverage {
  const methods = new Map<string, MethodCoverage>();
  const hasIstanbulData = !!runtimeData?.istanbul && Object.keys(runtimeData.istanbul).length > 0;
  const hasRuntimeData = !!runtimeData?.runtime && runtimeData.runtime.testResults.length > 0;

  // No runtime artifact means a hand-placed or pre-0.9.0 coverage file, which only
  // Istanbul ever produced — so defaulting to 'istanbul' preserves today's behavior
  // for every existing Jest project.
  const coverageProvider: CoverageProviderId = runtimeData?.runtime?.coverageProvider ?? 'istanbul';

  const classMethodOwners = buildClassMethodOwners(codeModel.modules);
  const runtimeMap = matchRuntimeTests(
    runtimeData?.runtime,
    codeModel.testInventory.testFiles,
    rootDir,
    classMethodOwners
  );

  const staticCoverage = codeModel.testInventory.coverage;

  for (const mod of codeModel.modules) {
    for (const c of allCallables(mod)) {
      const absFilePath = path.resolve(rootDir, mod.filePath);

      // `coverage` keys class methods file-qualified (see extractor/index.ts)
      // so a same-named method on an unrelated class never shares static test
      // credit; standalone functions keep their bare-name key (frozen artifact
      // format). Both are `c.inventoryKey`.
      const mc: MethodCoverage = {
        className: c.owner,
        methodName: c.node.name,
        qualifiedName: c.qualifiedName,
        ownerKind: c.ownerKind,
        filePath: mod.filePath,
        staticTests: staticCoverage[c.inventoryKey] ?? [],
        isCovered: false,
        coverageSource: 'static',
      };

      if (hasIstanbulData && runtimeData!.istanbul) {
        const fileCov = runtimeData!.istanbul[absFilePath];
        if (fileCov) {
          const metrics = mapIstanbulToMethod(fileCov, c.node.startLine, c.node.endLine, coverageProvider);
          if (metrics) {
            mc.istanbul = metrics;
          }
        }
      }

      if (hasRuntimeData) {
        const rt = runtimeMap.get(c.inventoryKey);
        if (rt) {
          mc.runtime = {
            testNames: rt.passed,
            failedTests: rt.failed,
            skippedTests: rt.skipped,
            perTest: rt.perTest,
          };
        }
      }

      if (mc.istanbul) {
        mc.isCovered = mc.istanbul.linesCovered > 0;
        mc.coverageSource = 'istanbul';
      } else {
        mc.isCovered = mc.staticTests.length > 0;
        mc.coverageSource = 'static';
      }

      methods.set(c.key, mc);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of codeModel.modules) {
      for (const c of allCallables(mod)) {
        if (c.node.internalCalls.length === 0) continue;
        const callerMc = methods.get(c.key);
        if (!callerMc || callerMc.staticTests.length === 0) continue;

        for (const calleeName of c.node.internalCalls) {
          if (calleeName === c.node.name) continue;
          const calleeMc = methods.get(calleeKey(c, calleeName));
          if (calleeMc && calleeMc.staticTests.length === 0) {
            calleeMc.staticTests.push(...callerMc.staticTests);
            changed = true;
          }
        }
      }
    }
  }

  // `ClassName.methodName` → file-qualified keys, for callers that have no file
  // path in hand (reasoner output, LLM ratings). Ambiguous names fail closed.
  const keysByName = new Map<string, string[]>();
  for (const [key, mc] of methods) {
    if (mc.ownerKind === 'module') continue; // functions: found via functionCoverageKey
    const list = keysByName.get(mc.qualifiedName);
    if (list) list.push(key);
    else keysByName.set(mc.qualifiedName, [key]);
  }

  function lookup(className: string, methodName: string, filePath: string): MethodCoverage | undefined {
    const byFile = methods.get(classMethodKey(filePath, className, methodName));
    if (byFile) return byFile;
    // standalone functions (className = module path)
    if (className === filePath) {
      const fn = methods.get(functionCoverageKey(filePath, methodName));
      if (fn) return fn;
    }
    const candidates = keysByName.get(`${className}.${methodName}`);
    return candidates && candidates.length === 1 ? methods.get(candidates[0]) : undefined;
  }

  return {
    methods,
    hasIstanbulData,
    hasRuntimeData,
    coverageProvider,
    isMethodCovered(className: string, methodName: string, filePath: string): boolean {
      return lookup(className, methodName, filePath)?.isCovered ?? false;
    },
    getMethodCoverage(className: string, methodName: string, filePath: string): MethodCoverage | undefined {
      return lookup(className, methodName, filePath);
    },
    getTestsForMethod(className: string, methodName: string, filePath: string): string[] {
      const mc = lookup(className, methodName, filePath);
      if (!mc) return [];
      const tests = new Set<string>(mc.staticTests);
      if (mc.runtime) {
        for (const t of mc.runtime.testNames) tests.add(t);
      }
      return [...tests];
    },
  };
}
