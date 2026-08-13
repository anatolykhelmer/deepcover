import fs from 'fs';
import path from 'path';
import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ScoreResult } from '../scorer/types';
import type { ScoreWeights } from '../scorer/composer';
import { runScorer } from '../scorer';
import { resolveCoverage } from '../resolver';
import {
  loadCodeModelFile,
  loadReasonerOutputFile,
  loadJestArtifacts,
  EMPTY_REASONER_OUTPUT,
} from './loaders';

export interface AnalyzeStageOptions {
  rootDir: string;
  deepcoverDir: string;
  bugs: boolean;
  weights?: ScoreWeights;
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

  const jestData = loadJestArtifacts(opts.deepcoverDir);
  if (!jestData) {
    notes.push(
      'No Jest artifacts in .deepcover — coverage falls back to static heuristics. Wire up the DeepCover Jest reporter and run tests with --coverage for accurate scores.',
    );
  }

  const resolvedCoverage = resolveCoverage(codeModel, opts.rootDir, jestData);
  const result = runScorer(codeModel, reasonerOutput, resolvedCoverage, {
    ...(opts.weights && { weights: opts.weights }),
    enableBugs: opts.bugs,
  });

  if (opts.bugs && !reasonerOutput.bugFindings) {
    notes.push(
      'Bug analysis used deterministic detectors only — run `deepcover reason --bugs` for LLM validation and extra patterns.',
    );
  }

  return { result, notes };
}
