import path from 'path';
import { globSync } from 'glob';
import { Project } from 'ts-morph';
import { analyzeClasses } from './class-analyzer';
import { analyzeFunctions } from './function-analyzer';
import { buildDependencyGraph } from './dependency-graph';
import { analyzeTestFile } from './test-analyzer';
import type {
  CodeModel,
  ModuleNode,
  ClassNode,
  FunctionNode,
  TestInventory,
  TestFileNode,
} from '../types/code-model';
import { buildClassMethodOwners, resolveClassMethodKey } from '../types/method-owner';

export interface TsMorphProjectOptions {
  skipAddingFilesFromTsConfig?: boolean;
  compilerOptions?: { strict?: boolean; skipLibCheck?: boolean };
}

export interface ExtractOptions {
  rootDir: string;
  include?: string[];
  exclude?: string[];
  testPattern?: string[];
  /** Options for ts-morph Project when analyzing codebases with external deps (e.g. NestJS) */
  projectOptions?: TsMorphProjectOptions;
}

const DEFAULT_INCLUDE = ['**/*.ts'];
const DEFAULT_EXCLUDE = ['**/*.spec.ts', '**/*.test.ts', '**/node_modules/**'];
const DEFAULT_TEST_PATTERN = ['**/*.spec.ts', '**/*.test.ts'];

function findFiles(rootDir: string, patterns: string[], ignore?: string[]): string[] {
  const matches = new Set<string>();
  for (const pattern of patterns) {
    const files = globSync(pattern, {
      cwd: rootDir,
      absolute: true,
      ignore: ignore ?? ['**/node_modules/**'],
      nodir: true,
    });
    files.forEach((f) => matches.add(f));
  }
  return Array.from(matches);
}


export function extractCodeModel(options: ExtractOptions): CodeModel {
  const {
    rootDir,
    include = DEFAULT_INCLUDE,
    exclude = DEFAULT_EXCLUDE,
    testPattern = DEFAULT_TEST_PATTERN,
    projectOptions,
  } = options;

  const baseCompilerOptions = { target: 99, module: 1, strict: true };
  const mergedCompilerOptions = projectOptions?.compilerOptions
    ? { ...baseCompilerOptions, ...projectOptions.compilerOptions }
    : baseCompilerOptions;

  const project = new Project({
    ...(projectOptions?.skipAddingFilesFromTsConfig && { skipAddingFilesFromTsConfig: true }),
    compilerOptions: mergedCompilerOptions,
  });

  const excludedSet = new Set(findFiles(rootDir, exclude, []));
  const allSourcePaths = findFiles(rootDir, include);
  const sourcePaths = allSourcePaths.filter((p) => !excludedSet.has(p));
  const testPaths = findFiles(rootDir, testPattern);

  for (const filePath of sourcePaths) {
    project.addSourceFileAtPath(filePath);
  }

  const allClassNodes: ClassNode[] = [];
  const allFunctionNodes: FunctionNode[] = [];
  const modules: ModuleNode[] = [];

  for (const filePath of sourcePaths) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) continue;

    const classes = analyzeClasses(sourceFile);
    const functions = analyzeFunctions(sourceFile);
    allClassNodes.push(...classes);
    allFunctionNodes.push(...functions);
    modules.push({
      filePath,
      classes,
      functions,
    });
  }

  const dependencyGraph = buildDependencyGraph(allClassNodes);

  const testFiles: TestFileNode[] = [];
  for (const filePath of testPaths) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      project.addSourceFileAtPath(filePath);
    }
    const testSourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
    const testFileNode = analyzeTestFile(testSourceFile);
    testFiles.push(testFileNode);
  }

  const classMethodOwners = buildClassMethodOwners(modules);
  const functionNames = new Set<string>();
  for (const fn of allFunctionNodes) {
    functionNames.add(fn.name);
  }

  const coverage: Record<string, string[]> = {};
  const addCoverage = (key: string, testName: string) => {
    if (!coverage[key]) coverage[key] = [];
    coverage[key].push(testName);
  };

  for (const testFile of testFiles) {
    for (const describe of testFile.describes) {
      for (const test of describe.tests) {
        if (!test.targetMethod) continue;

        const owners = classMethodOwners.get(test.targetMethod);
        if (owners && owners.size > 0) {
          // Class-owned method: only credit the class (and, when the class name is
          // declared in several files, the specific file) this test actually resolved
          // to — fail closed (drop it) when that can't be determined, since a
          // same-named method on an unrelated class must never share coverage.
          const key = resolveClassMethodKey(
            test.targetMethod,
            test.targetClass ?? null,
            test.targetClassFile ?? null,
            classMethodOwners
          );
          if (key) {
            addCoverage(key, test.name);
          }
          continue;
        }

        if (functionNames.has(test.targetMethod)) {
          addCoverage(test.targetMethod, test.name);
        }
      }
    }
  }

  const testInventory: TestInventory = {
    testFiles,
    coverage,
  };

  return {
    modules,
    dependencyGraph,
    testInventory,
  };
}
