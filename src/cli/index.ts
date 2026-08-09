#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeCommand } from './commands/analyze';
import { scoreCommand } from './commands/score';
import { extractCommand } from './commands/extract';
import { initCommand } from './commands/init';
import { reasonCommand } from './commands/reason';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('deepcover')
  .description('Agentic code coverage analyzer')
  .version(version);

program.addCommand(analyzeCommand);
program.addCommand(scoreCommand);
program.addCommand(extractCommand);
program.addCommand(reasonCommand);
program.addCommand(initCommand);

void program.parseAsync(process.argv);
