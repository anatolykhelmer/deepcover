import fs from 'fs';
import { Command, Option } from 'commander';
import { loadConfig } from '../config';
import { assertNoLegacyFlags, type LegacyFlagCarrier } from '../legacy-flags';
import { formatTerminalReport, formatScore } from '../formatters/terminal';
import { resolvePaths } from '../../pipeline/loaders';
import { runAnalyzeStage } from '../../pipeline/analyze-stage';
import type { ScoreWeights } from '../../scorer/composer';

const VALID_FORMATS = ['terminal', 'json', 'score'] as const;
type Format = (typeof VALID_FORMATS)[number];

function isValidFormat(format: string): format is Format {
  return (VALID_FORMATS as readonly string[]).includes(format);
}

export interface AnalyzeCommandOptions extends LegacyFlagCarrier {
  root: string;
  format: string;
  minScore?: string;
  bugThreshold?: string;
  bugs?: boolean;
}

/** Shared by `analyze` and its `score` alias. */
export function runAnalyzeCommand(options: AnalyzeCommandOptions, commandName: string): void {
  try {
    assertNoLegacyFlags(options, commandName);

    if (!isValidFormat(options.format)) {
      throw new Error(`Unknown --format '${options.format}' — expected one of: ${VALID_FORMATS.join(', ')}`);
    }

    const paths = resolvePaths({ root: options.root });
    const config = loadConfig(paths.rootDir);

    const { result, notes } = runAnalyzeStage({
      rootDir: paths.rootDir,
      deepcoverDir: paths.deepcoverDir,
      bugs: !!options.bugs,
      ...(config.weights && { weights: config.weights as ScoreWeights }),
    });

    for (const note of notes) console.error(note);

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (options.format === 'score') {
      // Sync write so CI callers never see an empty pipe if the process exits quickly.
      fs.writeSync(process.stdout.fd, formatScore(result));
    } else {
      console.log(formatTerminalReport(result));
    }

    const composite = Math.round(result.composite);
    if (options.minScore !== undefined && composite < parseInt(options.minScore, 10)) {
      process.exitCode = 1;
      return;
    }
    if (options.bugThreshold && options.bugs) {
      const threshold = parseInt(options.bugThreshold, 10);
      const highRisk = result.potentialBugs.filter((b) => b.risk === 'high').length;
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
}

/** Removed in 0.3.0 — declared only so our migration error runs instead of Commander's. */
export function addRemovedFlagOptions(command: Command): Command {
  return command
    .addOption(new Option('--no-llm').hideHelp())
    .addOption(new Option('--reasoner-input <file>').hideHelp())
    .addOption(new Option('--module <path>').hideHelp())
    .addOption(new Option('--file <path>').hideHelp());
}

export const analyzeCommand = addRemovedFlagOptions(
  new Command('analyze')
    .description('Score the extracted model against reasoner output and coverage')
    .option('--root <path>', 'project root', process.cwd())
    .option('--format <format>', 'output format: terminal, json, or score', 'terminal')
    .option('--min-score <number>', 'exit 1 if the composite score is below this')
    .option('--bug-threshold <number>', 'exit 1 if high-risk bugs >= threshold')
    .option('--bugs', 'include bug analysis in the report'),
).action((options: AnalyzeCommandOptions) => {
  runAnalyzeCommand(options, 'analyze');
});
