import fs from 'fs';
import path from 'path';
import os from 'os';
import { Command } from 'commander';

export interface InitTargetOptions {
  project?: boolean;
  cwd?: string;
  homeDir?: string;
}

export interface InstallCursorSkillOptions extends InitTargetOptions {
  /** Override packaged skill path (tests). */
  skillSource?: string;
}

export interface InstallCursorSkillResult {
  targetPath: string;
  updated: boolean;
}

export function resolveSkillTarget(options: InitTargetOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  if (options.project) {
    return path.join(cwd, '.cursor', 'skills', 'deepcover', 'SKILL.md');
  }

  return path.join(homeDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
}

/** Packaged skill shipped with the npm package (single source with repo Cursor skill). */
export function defaultSkillSource(): string {
  // dist/cli/commands → package root
  const packageRoot = path.resolve(__dirname, '../../..');
  return path.join(packageRoot, '.cursor', 'skills', 'deepcover', 'SKILL.md');
}

export function installCursorSkill(
  options: InstallCursorSkillOptions = {},
): InstallCursorSkillResult {
  const skillSource = options.skillSource ?? defaultSkillSource();
  if (!fs.existsSync(skillSource)) {
    throw new Error(`Skill source not found: ${skillSource}`);
  }

  const targetPath = resolveSkillTarget(options);
  const updated = fs.existsSync(targetPath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(skillSource, targetPath);

  return { targetPath, updated };
}

export const initCommand = new Command('init')
  .description('Install the Cursor skill for DeepCover (personal by default)')
  .option('--project', 'install into ./.cursor/skills (share with the repo)', false)
  .action((options: { project?: boolean }) => {
    try {
      const result = installCursorSkill({ project: options.project });
      const scope = options.project ? 'project' : 'personal';
      const verb = result.updated ? 'Updated' : 'Installed';
      console.log(`${verb} Cursor skill (${scope}):`);
      console.log(`  ${result.targetPath}`);
      console.log('');
      console.log('In Cursor Agent, say: "run deepcover on <module>"');
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });
