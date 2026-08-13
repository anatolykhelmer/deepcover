import fs from 'fs';
import { Command } from 'commander';
import { loadConfig } from '../config';
import { formatTerminalReport, formatScore } from '../formatters/terminal';
import { resolvePaths } from '../../pipeline/loaders';
import { runPipeline } from '../../pipeline/run-pipeline';
import { resolveReasoner } from '../resolve-provider';
import type { ScoreWeights } from '../../scorer/composer';

export const runCommand = new Command('run')
  .description('One-shot: extract, reason, and analyze in sequence')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module to analyze (relative to root)')
  .option('--file <path>', 'single file to analyze')
  .option('--output <dir>', 'artifact directory (default: <root>/.deepcover)')
  .option('--no-llm', 'skip the reason stage (deterministic only)')
  .option('--format <format>', 'output format: terminal, json, or score', 'terminal')
  .option('--min-score <number>', 'exit 1 if the composite score is below this')
  .option('--bug-threshold <number>', 'exit 1 if high-risk bugs >= threshold')
  .option('--bugs', 'enable bug analysis across all three stages')
  .action(async (options: {
    root: string;
    module?: string;
    file?: string;
    output?: string;
    llm: boolean;
    format: string;
    minScore?: string;
    bugThreshold?: string;
    bugs?: boolean;
  }) => {
    try {
      const paths = resolvePaths({ root: options.root });
      const config = loadConfig(paths.rootDir);
      const reasoner = resolveReasoner(config);

      const result = await runPipeline({
        root: options.root,
        ...(options.module && { module: options.module }),
        ...(options.file && { file: options.file }),
        ...(options.output && { output: options.output }),
        bugs: !!options.bugs,
        llm: options.llm,
        reasoner,
        ...(config.weights && { weights: config.weights as ScoreWeights }),
      });

      for (const note of result.notes) console.error(note);

      if (result.stoppedAfterReason || !result.score) {
        process.exitCode = 0;
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(result.score, null, 2));
      } else if (options.format === 'score') {
        fs.writeSync(process.stdout.fd, formatScore(result.score));
      } else {
        console.log(formatTerminalReport(result.score));
      }

      const composite = Math.round(result.score.composite);
      if (options.minScore !== undefined && composite < parseInt(options.minScore, 10)) {
        process.exitCode = 1;
        return;
      }
      if (options.bugThreshold && options.bugs) {
        const threshold = parseInt(options.bugThreshold, 10);
        const highRisk = result.score.potentialBugs.filter((b) => b.risk === 'high').length;
        if (highRisk >= threshold) {
          process.exitCode = 1;
          return;
        }
      }
      process.exitCode = 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });
