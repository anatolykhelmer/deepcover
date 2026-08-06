import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { extractCodeModel } from '../../extractor';
import { runReasoner } from '../../reasoner';
import { runScorer } from '../../scorer';
import { resolveCoverage } from '../../resolver';
import type { IstanbulCoverageData, JestRuntimeData } from '../../resolver/types';
import { loadConfig } from '../config';
import { resolveLLMProvider } from '../resolve-provider';
import { ReasonerOutputSchema } from '../../reasoner/types';
import type { ReasonerOutput } from '../../reasoner/types';

const EMPTY_REASONER_OUTPUT: ReasonerOutput = {
  discoveredStates: [],
  assertionJudgments: [],
  criticalityRatings: [],
  transitiveInferences: [],
};

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

function loadReasonerInput(filePath: string): ReasonerOutput | null {
  try {
    const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
    const parsed = JSON.parse(raw);
    return ReasonerOutputSchema.parse(parsed);
  } catch (err) {
    console.error(`Warning: could not load reasoner input from ${filePath}: ${err}`);
    return null;
  }
}

function loadJestData(rootDir: string): { istanbul?: IstanbulCoverageData; runtime?: JestRuntimeData } | undefined {
  const deepcoverDir = path.resolve(rootDir, '.deepcover');
  const jestData: { istanbul?: IstanbulCoverageData; runtime?: JestRuntimeData } = {};

  const istanbulPath = path.join(deepcoverDir, 'istanbul-coverage.json');
  if (fs.existsSync(istanbulPath)) {
    try {
      jestData.istanbul = JSON.parse(fs.readFileSync(istanbulPath, 'utf-8'));
    } catch { /* ignore malformed file */ }
  }

  const runtimePath = path.join(deepcoverDir, 'jest-runtime.json');
  if (fs.existsSync(runtimePath)) {
    try {
      jestData.runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf-8'));
    } catch { /* ignore malformed file */ }
  }

  return jestData.istanbul || jestData.runtime ? jestData : undefined;
}

export const scoreCommand = new Command('score')
  .description('Output composite score for CI gating')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module to analyze (relative to root)')
  .option('--file <path>', 'single file to analyze')
  .option('--no-llm', 'skip LLM reasoning (deterministic only)')
  .option('--reasoner-input <file>', 'path to pre-computed ReasonerOutput JSON (from Cursor agent)')
  .option('--min-score <number>', 'minimum score threshold (exit 1 if below)', '0')
  .option('--bugs', 'enable bug-finding analysis')
  .option('--bug-threshold <number>', 'exit 1 if high-risk bugs >= threshold')
  .action(async (options: {
    root: string;
    module?: string;
    file?: string;
    llm: boolean;
    reasonerInput?: string;
    minScore: string;
    bugs?: boolean;
    bugThreshold?: string;
  }) => {
    const { rootDir, include } = resolvePaths(options.root, options.module, options.file);
    const config = loadConfig(rootDir);

    const codeModel = extractCodeModel({
      rootDir,
      ...(include && { include }),
    });

    let reasonerOutput: ReasonerOutput;

    if (options.reasonerInput) {
      reasonerOutput = loadReasonerInput(options.reasonerInput) ?? EMPTY_REASONER_OUTPUT;
    } else if (options.llm) {
      const provider = resolveLLMProvider(config);
      reasonerOutput = await runReasoner(codeModel, provider);
    } else {
      reasonerOutput = EMPTY_REASONER_OUTPUT;
    }

    const jestData = loadJestData(rootDir);
    const resolvedCoverage = resolveCoverage(codeModel, rootDir, jestData);
    const result = runScorer(codeModel, reasonerOutput, resolvedCoverage, {
      weights: config.weights as import('../../scorer/composer').ScoreWeights | undefined,
      enableBugs: !!options.bugs,
    });
    const composite = Math.round(result.composite);
    const minScore = parseInt(options.minScore, 10);

    // Sync write so CI callers never see an empty pipe if the process exits quickly.
    fs.writeSync(process.stdout.fd, `${composite}\n`);

    if (composite < minScore) {
      process.exitCode = 1;
      return;
    }
    if (options.bugThreshold && options.bugs) {
      const threshold = parseInt(options.bugThreshold, 10);
      const highRiskCount = result.potentialBugs.filter((b) => b.risk === 'high').length;
      if (highRiskCount >= threshold) {
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = 0;
  });
