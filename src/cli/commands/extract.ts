import path from 'path';
import { Command } from 'commander';
import { resolvePaths } from '../../pipeline/loaders';
import { runExtractStage } from '../../pipeline/extract-stage';

export const extractCommand = new Command('extract')
  .description('Extract the CodeModel and Reasoner prompts into .deepcover')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module to analyze (relative to root)')
  .option('--file <path>', 'single file to analyze')
  .option('--output <dir>', 'output directory (default: <root>/.deepcover)')
  .option('--bugs', 'include deterministic bug signals and the bug-finding prompt')
  .action((options: { root: string; module?: string; file?: string; output?: string; bugs?: boolean }) => {
    const paths = resolvePaths({
      root: options.root,
      ...(options.module && { module: options.module }),
      ...(options.file && { file: options.file }),
      ...(options.output && { output: options.output }),
    });

    const result = runExtractStage({
      ...paths,
      ...(options.module && { module: options.module }),
      ...(options.file && { file: options.file }),
      bugs: !!options.bugs,
    });

    for (const note of result.notes) console.error(note);

    const classCount = result.codeModel.modules.reduce((n, m) => n + m.classes.length, 0);
    const methodCount =
      result.codeModel.modules.reduce(
        (n, m) => n + m.classes.reduce((k, c) => k + c.methods.length, 0),
        0,
      ) + result.codeModel.modules.reduce((n, m) => n + (m.functions?.length ?? 0), 0);

    console.log(`Extracted to ${paths.deepcoverDir}/`);
    console.log(`  code-model.json      — ${classCount} classes, ${methodCount} methods`);
    console.log(`  prompts.json         — Reasoner prompts${options.bugs ? ' (including bug finding)' : ''}`);
    if (options.bugs) {
      console.log(`  bug-signals.json     — ${result.bugSignalCount} deterministic bug signals`);
    }
    console.log(`  reasoner-output.json — template for the Reasoner to fill`);
    console.log(`  README.md            — instructions for the Reasoner agent`);
    console.log('');
    console.log(`Next: \`deepcover reason --root ${paths.rootDir}${options.bugs ? ' --bugs' : ''}\``);
    console.log(`  then \`deepcover analyze --root ${paths.rootDir}${options.bugs ? ' --bugs' : ''}\``);
  });
