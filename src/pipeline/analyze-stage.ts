import fs from 'fs';
import path from 'path';
import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ScoreResult } from '../scorer/types';
import type { ScoreWeights } from '../scorer/composer';
import { runScorer } from '../scorer';
import { resolveCoverage } from '../resolver';
import { missingRuntimeNote } from '../framework';
import {
  loadCodeModelFile,
  loadReasonerOutputFile,
  loadRuntimeArtifacts,
  EMPTY_REASONER_OUTPUT,
} from './loaders';

export interface AnalyzeStageOptions {
  rootDir: string;
  deepcoverDir: string;
  bugs: boolean;
  weights?: ScoreWeights;
  /** Fraction (0-1) from `reasoner.maxInfluence`; the scorer converts to points. */
  maxInfluence?: number;
}

export interface AnalyzeStageResult {
  result: ScoreResult;
  /** Human-facing lines for the CLI to print on stderr. */
  notes: string[];
}

const SECTIONS = [
  { key: 'discoveredStates', label: 'Domain States', impact: 'State Coverage' },
  { key: 'assertionJudgments', label: 'Assertion Quality Judgments', impact: 'Assertion Quality' },
  { key: 'criticalityRatings', label: 'Criticality Ratings', impact: 'Criticality Weight' },
  { key: 'transitiveInferences', label: 'Transitive Inferences', impact: 'Mutation Resilience' },
] as const;

/**
 * Best-effort staleness check: a source file the model already knows about has
 * changed since extraction. Files created after the extract are invisible here —
 * catching those would mean re-globbing, which is the extract stage's job.
 */
function stalenessNote(codeModel: CodeModel, codeModelPath: string): string | undefined {
  let modelMtime: number;
  try {
    modelMtime = fs.statSync(codeModelPath).mtimeMs;
  } catch {
    return undefined;
  }

  const newer = codeModel.modules
    .map((m) => m.filePath)
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).mtimeMs > modelMtime;
      } catch {
        return false;
      }
    });

  if (newer.length === 0) return undefined;
  const sample = newer.slice(0, 3).join(', ');
  return `code-model.json is out of date — ${newer.length} source file(s) changed since extraction (${sample}${newer.length > 3 ? ', …' : ''}). Re-run \`deepcover extract\`.`;
}

export function runAnalyzeStage(opts: AnalyzeStageOptions): AnalyzeStageResult {
  const notes: string[] = [];
  const codeModelPath = path.join(opts.deepcoverDir, 'code-model.json');
  const reasonerPath = path.join(opts.deepcoverDir, 'reasoner-output.json');

  const codeModel = loadCodeModelFile(codeModelPath);
  const stale = stalenessNote(codeModel, codeModelPath);
  if (stale) notes.push(stale);

  const loaded = loadReasonerOutputFile(reasonerPath);
  let reasonerOutput: ReasonerOutput;

  if (loaded.status === 'ok') {
    reasonerOutput = loaded.output;
    notes.push(`Using ${reasonerPath}.`);
    const empty = SECTIONS.filter((s) => (reasonerOutput[s.key] as unknown[]).length === 0);
    if (empty.length === SECTIONS.length) {
      notes.push(
        'reasoner-output.json is an empty template — scoring is deterministic only. Run `deepcover reason` or have your agent fill it.',
      );
    } else if (empty.length > 0) {
      notes.push(`Reasoner output has ${empty.length} empty section(s) — LLM adjustment will be 0 for:`);
      for (const s of empty) notes.push(`  • ${s.label} → ${s.impact} will use base score only`);
    }
  } else if (loaded.status === 'missing') {
    reasonerOutput = EMPTY_REASONER_OUTPUT;
    notes.push(
      'No reasoner-output.json — scoring is deterministic only. Run `deepcover reason` to add LLM insight.',
    );
  } else {
    reasonerOutput = EMPTY_REASONER_OUTPUT;
    notes.push(
      `reasoner-output.json could not be read (${loaded.error}) — scoring deterministic only.`,
    );
  }

  const runtimeData = loadRuntimeArtifacts(opts.deepcoverDir);
  if (!runtimeData) {
    notes.push(missingRuntimeNote(opts.rootDir));
  }

  const resolvedCoverage = resolveCoverage(codeModel, opts.rootDir, runtimeData);

  // Two distinct situations, previously collapsed into one condition on the provider id.
  if (runtimeData?.ignoredStaleIstanbul) {
    notes.push(
      'Coverage data on disk was ignored: the runtime artifact records ' +
        "coverageProvider: 'none' (this run did not measure coverage), so the coverage " +
        'file present belongs to an earlier run. Scoring fell back to static test ' +
        'attribution — re-run with --coverage for coverage-based results.',
    );
  } else if (resolvedCoverage.hasIstanbulData && !resolvedCoverage.measuresOperands) {
    // The artifact records which runner produced it, so name only the remedy that
    // applies: a Jest user has no use for a Vitest package, and vice versa.
    const remedy =
      runtimeData?.runtime?.framework === 'vitest'
        ? 'Switch to @vitest/coverage-istanbul — or, if these sources simply have no ' +
          'compound conditions for the v8 provider to remap, expect switching to change nothing.'
        : 'Switch to coverageProvider "babel" (Jest\'s default): Jest\'s v8-to-istanbul ' +
          'conversion emits no binary-expr branches.';
    notes.push(
      'The loaded coverage artifact carries no per-operand branch data — ' +
        `condition-operand analysis is disabled (not "found nothing"). ${remedy}`,
    );
  } else if (
    runtimeData?.runtime &&
    runtimeData.runtime.coverageProvider !== 'none' &&
    !resolvedCoverage.hasIstanbulData
  ) {
    // A run recorded a real provider — coverage was configured — but no coverage data
    // resolved: not stale ('none' would have taken the branch above), just absent.
    // Without this, the result is indistinguishable from a project that never
    // configured coverage: same fallback, silently. Common causes: coverage disabled
    // on this specific invocation despite the config, `reporter: ['json']` missing
    // from the coverage config, or a run that recorded 'istanbul'/'v8' but wrote no
    // report because it failed with reportOnFailure left off.
    notes.push(
      'The runtime artifact records coverage as measured, but no coverage data was ' +
        'found on disk — scoring fell back to static test attribution. Confirm the ' +
        "coverage config includes a 'json' reporter and that this run actually wrote one.",
    );
  }

  const result = runScorer(codeModel, reasonerOutput, resolvedCoverage, {
    ...(opts.weights && { weights: opts.weights }),
    ...(opts.maxInfluence !== undefined && { maxInfluence: opts.maxInfluence }),
    enableBugs: opts.bugs,
  });

  if (opts.bugs && !reasonerOutput.bugFindings) {
    notes.push(
      'Bug analysis used deterministic detectors only — run `deepcover reason --bugs` for LLM validation and extra patterns.',
    );
  }

  return { result, notes };
}
