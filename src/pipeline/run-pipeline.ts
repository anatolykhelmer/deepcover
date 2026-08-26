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
  /** Fraction (0-1) from `reasoner.maxInfluence`; caps the reasoner's score influence. */
  maxInfluence?: number;
  /**
   * From `include` in the config. `--module`/`--file` derive their own `include`
   * in `resolvePaths` and win over this, matching the flag > config precedence
   * the score threshold uses.
   */
  include?: string[];
  /** From `exclude` in the config. */
  exclude?: string[];
  /** From `testPattern` in the config. */
  testPattern?: string[];
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
    // `paths.include` is set only by --module/--file, so spreading the config's
    // include after it would let config silently override an explicit flag.
    ...(paths.include === undefined && opts.include && { include: opts.include }),
    ...(opts.exclude && { exclude: opts.exclude }),
    ...(opts.testPattern && { testPattern: opts.testPattern }),
    ...(opts.module && { module: opts.module }),
    ...(opts.file && { file: opts.file }),
    bugs: opts.bugs,
    ...(opts.maxInfluence !== undefined && { maxInfluence: opts.maxInfluence }),
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
    ...(opts.maxInfluence !== undefined && { maxInfluence: opts.maxInfluence }),
  });
  notes.push(...analyze.notes);

  return { score: analyze.result, stoppedAfterReason: false, notes };
}
