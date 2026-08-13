import fs from 'fs';
import path from 'path';
import type { CodeModel, ModuleNode } from '../types/code-model';
import type { BugSignal } from '../bug-detector/types';
import type { ReasonerOutput } from '../reasoner/types';
import { ReasonerOutputSchema } from '../reasoner/types';
import type { MethodCoverageInfo } from '../reasoner/prompts/criticality';
import type { IstanbulCoverageData, JestRuntimeData } from '../resolver/types';
import { loadIstanbulCoverage } from '../resolver/istanbul-source';
import { mapIstanbulToMethod } from '../resolver/istanbul-mapper';
import { resolveCoverage } from '../resolver';
import { runBugDetector } from '../bug-detector';

export const EMPTY_REASONER_OUTPUT: ReasonerOutput = {
  discoveredStates: [],
  assertionJudgments: [],
  criticalityRatings: [],
  transitiveInferences: [],
};

export interface ResolvedPaths {
  rootDir: string;
  /** Where stage artifacts live. Defaults to `<rootDir>/.deepcover`. */
  deepcoverDir: string;
  include?: string[];
}

/**
 * Single source of path resolution for every stage. The artifact directory is
 * derived from `--root` so that `--root ../other-project` keeps its artifacts
 * with that project; only an explicit `--output` is taken as the user typed it.
 */
export function resolvePaths(opts: {
  root: string;
  module?: string;
  file?: string;
  output?: string;
}): ResolvedPaths {
  const rootDir = fs.existsSync(opts.root) ? fs.realpathSync(path.resolve(opts.root)) : path.resolve(opts.root);
  const deepcoverDir = opts.output ? path.resolve(opts.output) : path.join(rootDir, '.deepcover');

  let include: string[] | undefined;
  if (opts.file) {
    include = [opts.file];
  } else if (opts.module) {
    include = [`${opts.module.replace(/\/$/, '')}/**/*.ts`];
  }

  return { rootDir, deepcoverDir, ...(include && { include }) };
}

export interface JestArtifacts {
  istanbul?: IstanbulCoverageData;
  runtime?: JestRuntimeData;
}

export function loadJestArtifacts(deepcoverDir: string): JestArtifacts | undefined {
  const artifacts: JestArtifacts = {};
  artifacts.istanbul = loadIstanbulCoverage(deepcoverDir);

  const runtimePath = path.join(deepcoverDir, 'jest-runtime.json');
  if (fs.existsSync(runtimePath)) {
    try {
      artifacts.runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as JestRuntimeData;
    } catch (err) {
      console.warn(`Warning: could not parse ${runtimePath} — ignoring runtime data: ${err}`);
    }
  }

  return artifacts.istanbul || artifacts.runtime ? artifacts : undefined;
}

/**
 * Deterministic bug signals, computed the same way for every stage. Istanbul
 * data is used whenever it is available: a detector that cannot see real branch
 * coverage reports weaker evidence, and those signals used to leak from
 * `extract` into the LLM path via `bug-signals.json`.
 */
export function computeBugSignals(
  codeModel: CodeModel,
  rootDir: string,
  deepcoverDir: string,
): BugSignal[] {
  const istanbul = loadIstanbulCoverage(deepcoverDir);
  const resolved = resolveCoverage(codeModel, rootDir, istanbul ? { istanbul } : undefined);
  return runBugDetector(codeModel, resolved);
}

/**
 * Istanbul metrics keyed the way the criticality prompt wants them. Shared so
 * that `extract` (writing prompts.json) and `reason` (sending the same prompts
 * to a provider) enrich from identical data.
 */
export function loadIstanbulByMethod(
  deepcoverDir: string,
  modules: ModuleNode[],
): Map<string, MethodCoverageInfo> | undefined {
  const data = loadIstanbulCoverage(deepcoverDir);
  if (!data) return undefined;

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
}

export type ReasonerOutputStatus = 'untouched' | 'filled' | 'corrupt';

/** Emitted by every stage that would otherwise overwrite a filled file. */
export const KEPT_REASONER_OUTPUT_NOTE =
  'Kept the existing reasoner-output.json (it has content) — delete it to start from a fresh template.';

/** Emitted when an unparseable file is replaced, so the loss is never silent. */
export const REPLACED_REASONER_OUTPUT_NOTE =
  'Replaced reasoner-output.json — the existing file could not be parsed as JSON.';

/**
 * `untouched` (safe to rewrite silently), `filled` (the agent's work — keep it
 * and say why), or `corrupt` (unparseable — replaced, but the caller is told).
 *
 * `bugFindings` is checked alongside the four base arrays: an agent can run
 * `--bugs`, fill in `bugFindings.findings`/`signalValidations`, and leave the
 * base arrays empty — a realistic incremental workflow — and that content must
 * not look "untouched" just because the base arrays are.
 *
 * Lives here rather than in a stage because `extract` and `reason` both write
 * this file and must agree on when overwriting it destroys someone's work.
 */
export function classifyReasonerOutput(filePath: string): ReasonerOutputStatus {
  if (!fs.existsSync(filePath)) return 'untouched';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return 'corrupt';
  }

  const baseArraysEmpty = (
    ['discoveredStates', 'assertionJudgments', 'criticalityRatings', 'transitiveInferences'] as const
  ).every((key) => Array.isArray(parsed[key]) && (parsed[key] as unknown[]).length === 0);
  if (!baseArraysEmpty) return 'filled';

  const bugFindings = parsed.bugFindings as { findings?: unknown; signalValidations?: unknown } | undefined;
  if (bugFindings === undefined) return 'untouched';

  const bugFindingsEmpty =
    Array.isArray(bugFindings.findings) &&
    bugFindings.findings.length === 0 &&
    Array.isArray(bugFindings.signalValidations) &&
    bugFindings.signalValidations.length === 0;
  return bugFindingsEmpty ? 'untouched' : 'filled';
}

export type ReasonerOutputLoad =
  | { status: 'ok'; output: ReasonerOutput }
  | { status: 'missing' }
  | { status: 'invalid'; error: string };

export function loadReasonerOutputFile(filePath: string): ReasonerOutputLoad {
  if (!fs.existsSync(filePath)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { status: 'ok', output: ReasonerOutputSchema.parse(parsed) };
  } catch (err) {
    return { status: 'invalid', error: err instanceof Error ? err.message : String(err) };
  }
}

function isCodeModelShape(value: unknown): value is CodeModel {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.modules) && Array.isArray(v.dependencyGraph) && typeof v.testInventory === 'object';
}

export function loadCodeModelFile(filePath: string): CodeModel {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Code model not found: ${abs}\n` +
        '  Run `deepcover extract --root <path> --module <path>` first, or `deepcover run` for a one-shot analysis.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse code model JSON at ${abs}: ${err}`);
  }
  if (!isCodeModelShape(parsed)) {
    throw new Error(`Invalid CodeModel at ${abs}: expected { modules, dependencyGraph, testInventory }`);
  }
  return parsed;
}
