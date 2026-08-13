import type { ScoreResult } from '../scorer/types';
import type { ScoreWeights } from '../scorer/composer';
import type { ResolvedReasoner } from './reasoner-mode';
import { resolvePaths } from './loaders';
import { runExtractStage } from './extract-stage';
import { runReasonStage } from './reason-stage';
import { runAnalyzeStage } from './analyze-stage';

export interface RunPipelineOptions {
  root: string;
  module?: string;
  file?: string;
  output?: string;
  bugs: boolean;
  /** `false` skips the reason stage — the deterministic-only path. */
  llm: boolean;
  reasoner: ResolvedReasoner;
  weights?: ScoreWeights;
}

export interface RunPipelineResult {
  score?: ScoreResult;
  /** True when an external agent must fill reasoner-output.json before scoring. */
  stoppedAfterReason: boolean;
  notes: string[];
}

/**
 * One-shot composition of the three stages. Deliberately routed through the same
 * disk artifacts the individual commands use: a second, in-memory path would be
 * exactly the kind of drift this pipeline exists to remove.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const notes: string[] = [];
  const paths = resolvePaths({
    root: opts.root,
    ...(opts.module && { module: opts.module }),
    ...(opts.file && { file: opts.file }),
    ...(opts.output && { output: opts.output }),
  });

  const extract = runExtractStage({
    ...paths,
    ...(opts.module && { module: opts.module }),
    ...(opts.file && { file: opts.file }),
    bugs: opts.bugs,
  });
  notes.push(...extract.notes);

  if (opts.llm) {
    const scope = {
      ...(opts.module && { module: opts.module }),
      wholeRepo: !opts.module && !opts.file,
    };
    const reason = await runReasonStage({
      rootDir: paths.rootDir,
      deepcoverDir: paths.deepcoverDir,
      bugs: opts.bugs,
      reasoner: opts.reasoner,
      scope,
    });
    notes.push(...reason.notes);

    if (reason.mode === 'agent-template') {
      return { stoppedAfterReason: true, notes };
    }
  } else {
    notes.push('Skipped the reason stage (--no-llm) — scoring deterministically.');
  }

  const analyze = runAnalyzeStage({
    rootDir: paths.rootDir,
    deepcoverDir: paths.deepcoverDir,
    bugs: opts.bugs,
    ...(opts.weights && { weights: opts.weights }),
  });
  notes.push(...analyze.notes);

  return { score: analyze.result, stoppedAfterReason: false, notes };
}
