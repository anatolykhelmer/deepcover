import fs from 'fs';
import path from 'path';
import type { CodeModel } from '../types/code-model';
import type { BugSignal } from '../bug-detector/types';
import type { ReasonerOutput } from '../reasoner/types';
import type { ReasonerScope } from '../reasoner/scope';
import type { ResolvedReasoner } from './reasoner-mode';
import { runReasoner } from '../reasoner';
import { scopeModelForReasoner } from '../reasoner/scope';
import {
  loadCodeModelFile,
  loadReasonerOutputFile,
  classifyReasonerOutput,
  computeBugSignals,
  loadIstanbulByMethod,
  loadJestArtifacts,
  EMPTY_REASONER_OUTPUT,
  KEPT_REASONER_OUTPUT_NOTE,
  REPLACED_REASONER_OUTPUT_NOTE,
} from './loaders';

export interface ReasonStageOptions {
  rootDir: string;
  deepcoverDir: string;
  bugs: boolean;
  reasoner: ResolvedReasoner;
  scope: ReasonerScope;
  /** Overrides `<deepcoverDir>/code-model.json`. */
  codeModelPath?: string;
  /** Overrides `<deepcoverDir>/reasoner-output.json`. */
  outputPath?: string;
}

export interface ReasonStageResult {
  output: ReasonerOutput;
  outputPath: string;
  mode: 'provider' | 'agent-template';
  /** False when an already-filled file at `outputPath` was left untouched. */
  wrote: boolean;
  notes: string[];
}

/**
 * Bug signals for the LLM job, preferring the file `extract --bugs` already
 * wrote so the agent and the provider validate the same evidence. Recomputing
 * uses the shared Istanbul-aware path.
 */
export function loadOrComputeBugSignals(
  rootDir: string,
  deepcoverDir: string,
  codeModel: CodeModel,
): BugSignal[] {
  const signalsPath = path.join(deepcoverDir, 'bug-signals.json');
  if (fs.existsSync(signalsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as BugSignal[];
      console.warn(`Warning: ${signalsPath} is not an array — recomputing bug signals`);
    } catch (err) {
      console.warn(`Warning: could not parse ${signalsPath} (${err}) — recomputing bug signals`);
    }
  }
  return computeBugSignals(codeModel, rootDir, deepcoverDir);
}

export async function runReasonStage(opts: ReasonStageOptions): Promise<ReasonStageResult> {
  const notes: string[] = [];
  const codeModelPath = opts.codeModelPath ?? path.join(opts.deepcoverDir, 'code-model.json');
  const outputPath = opts.outputPath ?? path.join(opts.deepcoverDir, 'reasoner-output.json');

  const codeModel = loadCodeModelFile(codeModelPath);
  const scopedModel = scopeModelForReasoner(codeModel, opts.scope);

  const write = (output: ReasonerOutput): void => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  };

  if (opts.reasoner.mode === 'agent-template') {
    notes.push(`Reasoner: ${opts.reasoner.providerName} (your coding agent).`);

    // In this mode the agent — not this process — is the thing that fills the
    // file, so a re-run must never overwrite what it already wrote. `extract`
    // makes the same judgement call; both go through classifyReasonerOutput.
    const status = classifyReasonerOutput(outputPath);
    if (status === 'filled') {
      const existing = loadReasonerOutputFile(outputPath);
      notes.push(KEPT_REASONER_OUTPUT_NOTE);
      if (existing.status === 'ok') {
        notes.push(`Next: \`deepcover analyze --root ${opts.rootDir}\` to score it.`);
        return { output: existing.output, outputPath, mode: 'agent-template', wrote: false, notes };
      }
      // Kept on disk regardless: it is the agent's work, and `analyze` reports
      // the schema error against the real file rather than a silent stand-in.
      notes.push(
        `The file does not validate against the ReasonerOutput schema — fix it before analyzing (${
          existing.status === 'invalid' ? existing.error : 'file disappeared'
        }).`,
      );
      return { output: EMPTY_REASONER_OUTPUT, outputPath, mode: 'agent-template', wrote: false, notes };
    }

    const output: ReasonerOutput = {
      ...EMPTY_REASONER_OUTPUT,
      ...(opts.bugs && { bugFindings: { findings: [], signalValidations: [] } }),
    };
    if (status === 'corrupt') notes.push(REPLACED_REASONER_OUTPUT_NOTE);
    write(output);
    notes.push(
      `Wrote an empty template to ${outputPath}.`,
      `Next: have the agent read ${path.join(opts.deepcoverDir, 'prompts.json')}, fill that file, then run \`deepcover analyze --root ${opts.rootDir}\`.`,
    );
    return { output, outputPath, mode: 'agent-template', wrote: true, notes };
  }

  const bugSignals = opts.bugs
    ? loadOrComputeBugSignals(opts.rootDir, opts.deepcoverDir, codeModel)
    : undefined;

  // Same enrichment `extract` writes into prompts.json, so the provider and the
  // agent reason over identical material.
  const runtime = loadJestArtifacts(opts.deepcoverDir)?.runtime;
  const istanbulCoverage = loadIstanbulByMethod(opts.deepcoverDir, codeModel.modules);

  const output = await runReasoner(scopedModel, opts.reasoner.provider, bugSignals, opts.scope, {
    ...(runtime && { runtime }),
    ...(istanbulCoverage && { istanbulCoverage }),
  });
  write(output);

  notes.push(`Reasoner: ${opts.reasoner.providerName} (CLI called the provider).`);
  if (opts.bugs && !output.bugFindings) {
    notes.push('Bug job returned nothing usable — scoring will fall back to deterministic signals.');
  }

  return { output, outputPath, mode: 'provider', wrote: true, notes };
}
