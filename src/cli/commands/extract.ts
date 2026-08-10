import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { extractCodeModel } from '../../extractor';
import { buildDomainStatesPrompt } from '../../reasoner/prompts/domain-states';
import { buildAssertionQualityPrompt } from '../../reasoner/prompts/assertion-quality';
import { buildCriticalityPrompt, type MethodCoverageInfo } from '../../reasoner/prompts/criticality';
import { buildTransitiveCoveragePrompt } from '../../reasoner/prompts/transitive-coverage';
import { buildBugFindingPrompt } from '../../reasoner/prompts/bug-finding';
import { runBugDetector } from '../../bug-detector';
import { resolveCoverage } from '../../resolver';
import { mapIstanbulToMethod } from '../../resolver/istanbul-mapper';
import type { ClassNode, FunctionNode, TestInventory } from '../../types/code-model';
import type { IstanbulCoverageData, JestRuntimeData } from '../../resolver/types';
import { loadIstanbulCoverage as readIstanbulCoverage } from '../../resolver/istanbul-source';
import {
  collectSourceMethodNames,
  filterClassesForPrompts,
  filterTestFilesByModule,
} from '../../reasoner/scope';

function buildTestsByMethod(
  testInventory: TestInventory,
  rootDir: string
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const file of testInventory.testFiles) {
    for (const block of file.describes) {
      for (const test of block.tests) {
        if (!test.targetMethod) continue;
        if (!result[test.targetMethod]) result[test.targetMethod] = [];
        result[test.targetMethod].push(test.name);
      }
    }
  }

  const runtimePath = path.join(path.resolve(rootDir, '.deepcover'), 'jest-runtime.json');
  if (fs.existsSync(runtimePath)) {
    try {
      const runtime: JestRuntimeData = JSON.parse(fs.readFileSync(runtimePath, 'utf-8'));
      const runtimeNames = new Set(runtime.testResults.map((t) => t.testName));
      for (const method of Object.keys(result)) {
        const existing = new Set(result[method]);
        for (const name of runtimeNames) {
          if (!existing.has(name) && result[method].some((s) => name.includes(s))) {
            result[method].push(name);
          }
        }
      }
      for (const rt of runtime.testResults) {
        const alreadyMapped = Object.values(result).some((names) => names.includes(rt.testName));
        if (!alreadyMapped) {
          // Runtime-only tests (e.g. test.each) not captured by static analysis — skip,
          // they'll be available via the full runtime data in the analyze phase
        }
      }
    } catch { /* ignore malformed runtime file */ }
  }

  return result;
}

function loadIstanbulCoverage(
  outputDir: string,
  classes: ClassNode[],
  modules: { filePath: string; classes: ClassNode[]; functions?: FunctionNode[] }[],
): Map<string, MethodCoverageInfo> | undefined {
  const data = readIstanbulCoverage(outputDir);
  if (!data) return undefined;

  try {
    const result = new Map<string, MethodCoverageInfo>();

    for (const mod of modules) {
      const fileCoverage = Object.entries(data).find(
        ([filePath]) => filePath.endsWith(mod.filePath) || mod.filePath.endsWith(filePath),
      );
      if (!fileCoverage) continue;

      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          const metrics = mapIstanbulToMethod(fileCoverage[1], method.startLine, method.endLine);
          if (metrics) {
            result.set(`${cls.name}.${method.name}`, {
              lineCoveragePercent: metrics.lineCoveragePercent,
              branchCoveragePercent: metrics.branchCoveragePercent,
            });
          }
        }
      }

      for (const fn of mod.functions ?? []) {
        const metrics = mapIstanbulToMethod(fileCoverage[1], fn.startLine, fn.endLine);
        if (metrics) {
          result.set(`${mod.filePath}.${fn.name}`, {
            lineCoveragePercent: metrics.lineCoveragePercent,
            branchCoveragePercent: metrics.branchCoveragePercent,
          });
        }
      }
    }

    return result.size > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

function resolvePaths(root: string, module?: string, file?: string) {
  const rootDir = path.resolve(root);
  let include: string[] | undefined;
  if (file) {
    include = [file];
  } else if (module) {
    const base = module.replace(/\/$/, '');
    include = [`${base}/**/*.ts`];
  }
  return { rootDir, include };
}

function generateReadme({ classCount, methodCount }: { classCount: number; methodCount: number }): string {
  return `# DeepCover — Agent Instructions

This directory contains everything you need to perform an LLM-powered code coverage analysis.
No external tools or API keys required — you are the Reasoner.

## What's here

| File | Description |
|------|-------------|
| \`code-model.json\` | Structured code model: ${classCount} classes, ${methodCount} methods, with branches, test inventory, dependency graph |
| \`prompts.json\` | 4 pre-built prompts (one per Reasoner job) — read these as your instructions |
| \`reasoner-output.json\` | **Your deliverable** — empty template, fill it with your analysis |
| \`jest-runtime.json\` | *(if present)* Per-test pass/fail status, duration, assertion counts from Jest |
| \`istanbul-coverage.json\` | *(if present)* Istanbul line/branch/function coverage data |

## Your task

Read \`code-model.json\` to understand the codebase structure, then perform 4 analysis jobs.
For each job, read the corresponding prompt from \`prompts.json\` and produce structured output.

### Job 1 — Domain State Discovery (\`discoveredStates\`)

For each method, identify meaningful domain states that static analysis missed:
- Business scenarios, error conditions, external system states, data edge cases

\`\`\`json
{ "className": "...", "methodName": "...", "state": "...", "isTested": false, "riskIfUntested": "high", "confidence": 0.9 }
\`\`\`

### Job 2 — Assertion Quality Judgment (\`assertionJudgments\`)

For each test, judge assertion quality as **weak** / **medium** / **strong**:
- weak: only existence checks (toBeDefined, toBeTruthy)
- medium: checks values but not side effects
- strong: checks values AND verifies correct interactions

\`\`\`json
{ "testName": "...", "quality": "weak", "reasoning": "...", "confidence": 0.95 }
\`\`\`

### Job 3 — Criticality Assessment (\`criticalityRatings\`)

Rate each method's business criticality as **low** / **medium** / **high**:
- high: data mutations, external calls, payment/auth logic
- medium: data reads, aggregations, queries
- low: simple getters, formatting, constants

\`\`\`json
{ "className": "...", "methodName": "...", "criticality": "high", "reasoning": "...", "confidence": 0.95 }
\`\`\`

### Job 4 — Transitive Coverage (\`transitiveInferences\`)

For each dependency chain, determine if testing lower layers covers higher ones:
- Pure delegation → transitive coverage sufficient
- Data transformation in the middle → needs explicit test

\`\`\`json
{ "from": "A.method", "through": "B.method", "to": "C.method", "coveredTransitively": false, "caveat": "...", "confidence": 0.8 }
\`\`\`

## Writing your output

Combine all 4 jobs into \`reasoner-output.json\`:

\`\`\`json
{
  "discoveredStates": [...],
  "assertionJudgments": [...],
  "criticalityRatings": [...],
  "transitiveInferences": [...]
}
\`\`\`

Every item **must** have a \`confidence\` score (0–1). Be honest — the scorer caps LLM influence at ±20%.
Focus on the **most critical** gaps. 5 high-quality insights beat 50 generic ones.

## Running the final analysis

After writing \`reasoner-output.json\`, run:

\`\`\`bash
npx deepcover analyze \\
  --root <PROJECT_ROOT> \\
  --reasoner-input .deepcover/reasoner-output.json
\`\`\`

This produces a scored report: composite score (0–100), sub-scores, per-method breakdown, and prioritized gaps.

Add \`--format json\` for machine-readable output.
`;
}

export const extractCommand = new Command('extract')
  .description('Extract CodeModel and prompts for Cursor-driven analysis')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module to analyze (relative to root)')
  .option('--file <path>', 'single file to analyze')
  .option('--output <dir>', 'output directory', '.deepcover')
  .option('--bugs', 'include 5th bug-finding prompt and deterministic signals')
  .action(async (options: { root: string; module?: string; file?: string; output: string; bugs?: boolean }) => {
    const { rootDir, include } = resolvePaths(options.root, options.module, options.file);
    const outputDir = path.resolve(options.output);

    const codeModel = extractCodeModel({
      rootDir,
      ...(include && { include }),
    });

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(outputDir, 'code-model.json'),
      JSON.stringify(codeModel, null, 2),
    );

    const allClasses: ClassNode[] = codeModel.modules.flatMap((m) => m.classes);
    const standaloneFunctions = codeModel.modules
      .map((m) => ({ filePath: m.filePath, functions: m.functions ?? [] }))
      .filter((entry) => entry.functions.length > 0);
    const promptClasses = filterClassesForPrompts(allClasses);
    const testsByMethod = buildTestsByMethod(codeModel.testInventory, rootDir);

    const sourceMethodNames = collectSourceMethodNames(codeModel.modules);

    const relevantTestFiles = filterTestFilesByModule(
      codeModel.testInventory.testFiles,
      options.module,
      sourceMethodNames,
    );

    const relevantTestInventory: typeof codeModel.testInventory = {
      testFiles: relevantTestFiles,
      coverage: codeModel.testInventory.coverage,
    };

    const istanbulCoverage = loadIstanbulCoverage(outputDir, promptClasses, codeModel.modules);

    const prompts = {
      domainStates: buildDomainStatesPrompt({ classes: promptClasses, testsByMethod, standaloneFunctions }),
      assertionQuality: buildAssertionQualityPrompt({
        testFiles: relevantTestFiles,
        classes: promptClasses,
        standaloneFunctions,
      }),
      criticality: buildCriticalityPrompt({
        classes: promptClasses,
        dependencyGraph: codeModel.dependencyGraph,
        istanbulCoverage,
        standaloneFunctions,
      }),
      transitiveCoverage: buildTransitiveCoveragePrompt({
        edges: codeModel.dependencyGraph,
        classes: promptClasses,
        standaloneFunctions,
        testInventory: relevantTestInventory,
      }),
    };

    fs.writeFileSync(
      path.join(outputDir, 'prompts.json'),
      JSON.stringify(prompts, null, 2),
    );

    const template: Record<string, unknown> = {
      discoveredStates: [],
      assertionJudgments: [],
      criticalityRatings: [],
      transitiveInferences: [],
    };

    if (options.bugs) {
      template.bugFindings = {
        findings: [],
        signalValidations: [],
      };
    }

    fs.writeFileSync(
      path.join(outputDir, 'reasoner-output.json'),
      JSON.stringify(template, null, 2),
    );

    if (options.bugs) {
      const resolvedCov = resolveCoverage(codeModel, rootDir, undefined);
      const bugSignals = runBugDetector(codeModel, resolvedCov);

      const existingPrompts = JSON.parse(fs.readFileSync(path.join(outputDir, 'prompts.json'), 'utf-8'));
      existingPrompts.bugFinding = buildBugFindingPrompt({
        classes: promptClasses,
        testFiles: relevantTestFiles,
        bugSignals,
      });
      fs.writeFileSync(
        path.join(outputDir, 'prompts.json'),
        JSON.stringify(existingPrompts, null, 2),
      );

      fs.writeFileSync(
        path.join(outputDir, 'bug-signals.json'),
        JSON.stringify(bugSignals, null, 2),
      );

      console.log(`  bug-signals.json   — ${bugSignals.length} deterministic bug signals`);
      console.log(`  prompts.json       — updated with 5th bug-finding prompt`);
    }

    const methodCount = allClasses.reduce((n, c) => n + c.methods.length, 0)
      + standaloneFunctions.reduce((n, entry) => n + entry.functions.length, 0);

    fs.writeFileSync(
      path.join(outputDir, 'README.md'),
      generateReadme({ classCount: allClasses.length, methodCount }),
    );

    const testDirs = new Set<string>();
    for (const tf of codeModel.testInventory.testFiles) {
      const relPath = path.relative(rootDir, tf.filePath);
      const dir = path.dirname(relPath);
      testDirs.add(dir);
    }

    const moduleName = options.module
      ? path.basename(options.module.replace(/\/$/, ''))
      : undefined;
    const relevantTestDirs = moduleName
      ? Array.from(testDirs).filter((d) => d.includes(moduleName))
      : Array.from(testDirs);

    if (relevantTestDirs.length > 0) {
      fs.writeFileSync(
        path.join(outputDir, 'jest-paths.json'),
        JSON.stringify({ testDirectories: relevantTestDirs }, null, 2),
      );
    }

    const totalTestFiles = codeModel.testInventory.testFiles.length;
    const filteredTestFiles = relevantTestFiles.length;

    const filteredClassCount = allClasses.length - promptClasses.length;

    console.log(`Extracted to ${outputDir}/`);
    console.log(`  code-model.json    — CodeModel (${allClasses.length} classes, ${methodCount} methods)`);
    console.log(`  prompts.json       — 4 LLM prompts for Cursor agent${filteredClassCount > 0 ? ` (${filteredClassCount} zero-method classes filtered)` : ''}`);
    if (istanbulCoverage) {
      console.log(`  Istanbul coverage  — ${istanbulCoverage.size} methods with coverage data`);
    }
    if (filteredTestFiles < totalTestFiles) {
      console.log(`  test files in prompts: ${filteredTestFiles} of ${totalTestFiles} (filtered to module scope)`);
    }
    console.log(`  reasoner-output.json — template for Cursor agent to fill`);
    console.log(`  README.md          — instructions for the Reasoner agent`);

    if (relevantTestDirs.length > 0) {
      console.log(`\n  Jest test directories for this module:`);
      for (const d of relevantTestDirs.sort()) {
        console.log(`    ${d}/`);
      }
    }
  });
