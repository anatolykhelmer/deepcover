import path from 'path';
import { Command } from 'commander';
import { loadConfig } from '../config';
import { resolveReasoner } from '../resolve-provider';
import { reasonerScope } from '../reasoner-scope';
import { resolvePaths } from '../../pipeline/loaders';
import { runReasonStage } from '../../pipeline/reason-stage';

export const reasonCommand = new Command('reason')
  .description('Fill reasoner-output.json — via the configured LLM provider or a template for your agent')
  .option('--root <path>', 'project root', process.cwd())
  .option('--module <path>', 'module the extract was scoped to (affects test scoping)')
  .option('--file <path>', 'single file the extract was scoped to')
  .option('--code-model <file>', 'path to a CodeModel JSON (default: <root>/.deepcover/code-model.json)')
  .option('--output <file>', 'output path for ReasonerOutput JSON')
  .option('--bugs', 'include the bug-finding job (bugFindings)')
  .action(async (options: {
    root: string;
    module?: string;
    file?: string;
    codeModel?: string;
    output?: string;
    bugs?: boolean;
  }) => {
    const paths = resolvePaths({ root: options.root });
    const config = loadConfig(paths.rootDir);

    try {
      const reasoner = resolveReasoner(config);

      // A `--code-model` file may itself be a narrowed extract, so it never counts
      // as whole-repo; fail closed by scoping tests to the model's own sources.
      const scope = options.codeModel ? {} : reasonerScope(options);
      if (options.codeModel && (options.module || options.file)) {
        console.error('`--code-model` set; ignoring `--module`/`--file` — scope comes from the supplied model.');
      }

      const result = await runReasonStage({
        rootDir: paths.rootDir,
        deepcoverDir: paths.deepcoverDir,
        bugs: !!options.bugs,
        reasoner,
        scope,
        ...(options.codeModel && { codeModelPath: path.resolve(options.codeModel) }),
        ...(options.output && { outputPath: path.resolve(options.output) }),
      });

      for (const note of result.notes) console.error(note);

      console.log(`${result.wrote ? 'Wrote' : 'Kept'} ${result.outputPath}`);
      console.log(`  discoveredStates:      ${result.output.discoveredStates.length}`);
      console.log(`  assertionJudgments:    ${result.output.assertionJudgments.length}`);
      console.log(`  criticalityRatings:    ${result.output.criticalityRatings.length}`);
      console.log(`  transitiveInferences:  ${result.output.transitiveInferences.length}`);
      if (result.output.bugFindings) {
        console.log(`  bugFindings:           ${result.output.bugFindings.findings.length} findings`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });
