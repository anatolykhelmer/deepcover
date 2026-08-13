import fs from 'fs';
import path from 'path';
import type { CodeModel } from '../types/code-model';
import { extractCodeModel } from '../extractor';
import { scopeModelForReasoner } from '../reasoner/scope';
import { buildPrompts } from './prompts';
import {
  computeBugSignals,
  loadIstanbulByMethod,
  loadJestArtifacts,
  EMPTY_REASONER_OUTPUT,
} from './loaders';
import { generateReadme } from './extract-readme';

export interface ExtractStageOptions {
  rootDir: string;
  deepcoverDir: string;
  include?: string[];
  module?: string;
  file?: string;
  bugs: boolean;
}

export interface ExtractStageResult {
  codeModel: CodeModel;
  scopedModel: CodeModel;
  writtenFiles: string[];
  bugSignalCount: number;
  notes: string[];
}

/** An untouched template is safe to rewrite; a filled one is the agent's work. */
function isUntouchedTemplate(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return true;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown[]>;
    return (['discoveredStates', 'assertionJudgments', 'criticalityRatings', 'transitiveInferences'] as const).every(
      (key) => Array.isArray(parsed[key]) && parsed[key]!.length === 0,
    );
  } catch {
    return true;
  }
}

export function runExtractStage(opts: ExtractStageOptions): ExtractStageResult {
  const notes: string[] = [];
  const writtenFiles: string[] = [];
  const write = (name: string, contents: string): void => {
    const target = path.join(opts.deepcoverDir, name);
    fs.writeFileSync(target, contents);
    writtenFiles.push(target);
  };

  const codeModel = extractCodeModel({
    rootDir: opts.rootDir,
    ...(opts.include && { include: opts.include }),
  });

  const scope = {
    ...(opts.module && { module: opts.module }),
    wholeRepo: !opts.module && !opts.file,
  };
  const scopedModel = scopeModelForReasoner(codeModel, scope);

  fs.mkdirSync(opts.deepcoverDir, { recursive: true });
  write('code-model.json', JSON.stringify(codeModel, null, 2));

  const bugSignals = opts.bugs
    ? computeBugSignals(codeModel, opts.rootDir, opts.deepcoverDir)
    : undefined;

  const istanbulCoverage = loadIstanbulByMethod(opts.deepcoverDir, codeModel.modules);
  const runtime = loadJestArtifacts(opts.deepcoverDir)?.runtime;

  const prompts = buildPrompts({
    scopedModel,
    ...(istanbulCoverage && { istanbulCoverage }),
    ...(runtime && { runtime }),
    ...(bugSignals && { bugSignals }),
  });
  write('prompts.json', JSON.stringify(prompts, null, 2));

  if (bugSignals) {
    write('bug-signals.json', JSON.stringify(bugSignals, null, 2));
  }

  const templatePath = path.join(opts.deepcoverDir, 'reasoner-output.json');
  if (isUntouchedTemplate(templatePath)) {
    const template: Record<string, unknown> = { ...EMPTY_REASONER_OUTPUT };
    if (opts.bugs) template.bugFindings = { findings: [], signalValidations: [] };
    write('reasoner-output.json', JSON.stringify(template, null, 2));
  } else {
    notes.push(
      `Kept the existing reasoner-output.json (it has content) — delete it to start from a fresh template.`,
    );
  }

  const allClasses = codeModel.modules.flatMap((m) => m.classes);
  const methodCount =
    allClasses.reduce((n, c) => n + c.methods.length, 0) +
    codeModel.modules.reduce((n, m) => n + (m.functions?.length ?? 0), 0);
  write('README.md', generateReadme({ classCount: allClasses.length, methodCount }));

  const testDirs = new Set<string>();
  for (const tf of codeModel.testInventory.testFiles) {
    testDirs.add(path.dirname(path.relative(opts.rootDir, tf.filePath)));
  }
  const moduleName = opts.module ? path.basename(opts.module.replace(/\/$/, '')) : undefined;
  const relevantTestDirs = moduleName
    ? Array.from(testDirs).filter((d) => d.includes(moduleName))
    : Array.from(testDirs);
  if (relevantTestDirs.length > 0) {
    write('jest-paths.json', JSON.stringify({ testDirectories: relevantTestDirs }, null, 2));
  }

  return {
    codeModel,
    scopedModel,
    writtenFiles,
    bugSignalCount: bugSignals?.length ?? 0,
    notes,
  };
}
