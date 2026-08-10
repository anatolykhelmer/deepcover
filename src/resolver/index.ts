import path from 'path';
import type { CodeModel } from '../types/code-model';
import type {
  IstanbulCoverageData,
  JestRuntimeData,
  MethodCoverage,
  ResolvedCoverage,
} from './types';
import { mapIstanbulToMethod } from './istanbul-mapper';
import { matchRuntimeTests } from './runtime-matcher';
import { buildClassMethodOwners } from '../types/method-owner';

export { resolveCoverage };
export type { ResolvedCoverage, MethodCoverage } from './types';

function resolveCoverage(
  codeModel: CodeModel,
  rootDir: string,
  jestData?: {
    istanbul?: IstanbulCoverageData;
    runtime?: JestRuntimeData;
  }
): ResolvedCoverage {
  const methods = new Map<string, MethodCoverage>();
  const hasIstanbulData = !!jestData?.istanbul && Object.keys(jestData.istanbul).length > 0;
  const hasRuntimeData = !!jestData?.runtime && jestData.runtime.testResults.length > 0;

  const classMethodOwners = buildClassMethodOwners(codeModel.modules);
  const runtimeMap = matchRuntimeTests(
    jestData?.runtime,
    codeModel.testInventory.testFiles,
    rootDir,
    classMethodOwners
  );

  const staticCoverage = codeModel.testInventory.coverage;

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const method of cls.methods) {
        const qualifiedName = `${cls.name}.${method.name}`;
        const absFilePath = path.resolve(rootDir, mod.filePath);

        const mc: MethodCoverage = {
          className: cls.name,
          methodName: method.name,
          qualifiedName,
          filePath: mod.filePath,
          // `coverage` keys class methods by `ClassName.methodName` (see extractor/index.ts)
          // so a same-named method on an unrelated class never shares static test credit.
          staticTests: staticCoverage[qualifiedName] ?? [],
          isCovered: false,
          coverageSource: 'static',
        };

        if (hasIstanbulData && jestData!.istanbul) {
          const fileCov = jestData!.istanbul[absFilePath];
          if (fileCov) {
            const metrics = mapIstanbulToMethod(fileCov, method.startLine, method.endLine);
            if (metrics) {
              mc.istanbul = metrics;
            }
          }
        }

        if (hasRuntimeData) {
          const rt = runtimeMap.get(qualifiedName);
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

        methods.set(qualifiedName, mc);
      }
    }

    for (const fn of mod.functions ?? []) {
      const qualifiedName = `${mod.filePath}.${fn.name}`;
      const absFilePath = path.resolve(rootDir, mod.filePath);

      const mc: MethodCoverage = {
        className: mod.filePath,
        methodName: fn.name,
        qualifiedName,
        filePath: mod.filePath,
        staticTests: staticCoverage[fn.name] ?? [],
        isCovered: false,
        coverageSource: 'static',
      };

      if (hasIstanbulData && jestData!.istanbul) {
        const fileCov = jestData!.istanbul[absFilePath];
        if (fileCov) {
          const metrics = mapIstanbulToMethod(fileCov, fn.startLine, fn.endLine);
          if (metrics) {
            mc.istanbul = metrics;
          }
        }
      }

      if (hasRuntimeData) {
        const rt = runtimeMap.get(fn.name);
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

      methods.set(qualifiedName, mc);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          if (method.internalCalls.length === 0) continue;
          const callerMc = methods.get(`${cls.name}.${method.name}`);
          if (!callerMc || callerMc.staticTests.length === 0) continue;

          for (const calleeName of method.internalCalls) {
            if (calleeName === method.name) continue;
            const calleeMc = methods.get(`${cls.name}.${calleeName}`);
            if (calleeMc && calleeMc.staticTests.length === 0) {
              calleeMc.staticTests.push(...callerMc.staticTests);
              changed = true;
            }
          }
        }
      }

      for (const fn of mod.functions ?? []) {
        if (fn.internalCalls.length === 0) continue;
        const callerMc = methods.get(`${mod.filePath}.${fn.name}`);
        if (!callerMc || callerMc.staticTests.length === 0) continue;

        for (const calleeName of fn.internalCalls) {
          if (calleeName === fn.name) continue;
          const calleeMc = methods.get(`${mod.filePath}.${calleeName}`);
          if (calleeMc && calleeMc.staticTests.length === 0) {
            calleeMc.staticTests.push(...callerMc.staticTests);
            changed = true;
          }
        }
      }
    }
  }

  return {
    methods,
    hasIstanbulData,
    hasRuntimeData,
    isMethodCovered(className: string, methodName: string): boolean {
      return methods.get(`${className}.${methodName}`)?.isCovered ?? false;
    },
    getMethodCoverage(className: string, methodName: string): MethodCoverage | undefined {
      return methods.get(`${className}.${methodName}`);
    },
    getTestsForMethod(className: string, methodName: string): string[] {
      const mc = methods.get(`${className}.${methodName}`);
      if (!mc) return [];
      const tests = new Set<string>(mc.staticTests);
      if (mc.runtime) {
        for (const t of mc.runtime.testNames) tests.add(t);
      }
      return [...tests];
    },
  };
}
