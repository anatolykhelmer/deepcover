import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { extractCodeModel } from '../../extractor';
import { runReasoner } from '../../reasoner';
import { runBugDetector } from '../../bug-detector';
import { resolveCoverage } from '../../resolver';
import type { CodeModel } from '../../types/code-model';
import type { BugSignal } from '../../bug-detector/types';
import { loadConfig } from '../config';
import { resolveLLMProvider } from '../resolve-provider';
import { loadIstanbulCoverage } from '../../resolver/istanbul-source';
import { scopeModelForReasoner } from '../module-scope';

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

function isCodeModelShape(value: unknown): value is CodeModel {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.modules) && Array.isArray(v.dependencyGraph) && typeof v.testInventory === 'object';
}

function loadCodeModel(filePath: string): CodeModel {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Code model not found: ${abs}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse code model JSON at ${abs}: ${err}`);
  }
  if (!isCodeModelShape(parsed)) {
    throw new Error(
      `Invalid CodeModel at ${abs}: expected { modules, dependencyGraph, testInventory }`,
    );
  }
  return parsed;
}

function loadBugSignals(rootDir: string, codeModel: CodeModel): BugSignal[] {
  const signalsPath = path.join(rootDir, '.deepcover', 'bug-signals.json');
  if (fs.existsSync(signalsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as BugSignal[];
    } catch {
      console.warn(`Warning: could not parse ${signalsPath}; running bug detector instead`);
    }
  }
  const jestDataDir = path.resolve(rootDir, '.deepcover');
  const istanbul = loadIstanbulCoverage(jestDataDir);
  const resolved = resolveCoverage(
    codeModel,
    rootDir,
    istanbul ? { istanbul } : undefined,
  );
  return runBugDetector(codeModel, resolved);
}

export const reasonCommand = new Command('reason')
  .description('Run LLM Reasoner and write reasoner-output.json')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module to analyze (relative to root)')
  .option('--file <path>', 'single file to analyze')
  .option('--code-model <file>', 'path to existing CodeModel JSON (skips extract)')
  .option('--output <file>', 'output path for ReasonerOutput JSON')
  .option('--bugs', 'include bug-finding job (bugFindings)')
  .action(async (options: {
    root: string;
    module?: string;
    file?: string;
    codeModel?: string;
    output?: string;
    bugs?: boolean;
  }) => {
    const { rootDir, include } = resolvePaths(options.root, options.module, options.file);
    const config = loadConfig(rootDir);
    const outputPath = path.resolve(
      options.output ?? path.join(rootDir, '.deepcover', 'reasoner-output.json'),
    );

    let codeModel: CodeModel;
    if (options.codeModel) {
      if (options.module || options.file) {
        console.warn('Warning: --code-model set; ignoring --module/--file');
      }
      codeModel = loadCodeModel(options.codeModel);
    } else {
      codeModel = extractCodeModel({
        rootDir,
        ...(include && { include }),
      });
    }

    const scopedModel = scopeModelForReasoner(codeModel, options.module);

    const provider = resolveLLMProvider(config);
    const bugSignals = options.bugs ? loadBugSignals(rootDir, scopedModel) : undefined;
    const reasonerOutput = await runReasoner(scopedModel, provider, bugSignals);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(reasonerOutput, null, 2));

    console.log(`Wrote ${outputPath}`);
    console.log(`  discoveredStates:      ${reasonerOutput.discoveredStates.length}`);
    console.log(`  assertionJudgments:    ${reasonerOutput.assertionJudgments.length}`);
    console.log(`  criticalityRatings:    ${reasonerOutput.criticalityRatings.length}`);
    console.log(`  transitiveInferences:  ${reasonerOutput.transitiveInferences.length}`);
    if (reasonerOutput.bugFindings) {
      console.log(`  bugFindings:           ${reasonerOutput.bugFindings.findings.length} findings`);
    }
  });
