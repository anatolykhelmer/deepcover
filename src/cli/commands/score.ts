import { Command } from 'commander';
import { runAnalyzeCommand, addRemovedFlagOptions } from './analyze';

/** CI-friendly alias for `analyze --format score`. */
export const scoreCommand = addRemovedFlagOptions(
  new Command('score')
    .description('Print the composite score only — alias for `analyze --format score`')
    .option('--root <path>', 'project root', process.cwd())
    .option('--min-score <number>', 'exit 1 if the composite score is below this', '0')
    .option('--bug-threshold <number>', 'exit 1 if high-risk bugs >= threshold')
    .option('--bugs', 'include bug analysis when applying --bug-threshold'),
).action((options: { root: string; minScore: string; bugThreshold?: string; bugs?: boolean }) => {
  runAnalyzeCommand({ ...options, format: 'score' }, 'score');
});
