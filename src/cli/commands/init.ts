import fs from 'fs';
import path from 'path';
import os from 'os';
import { Command } from 'commander';

export type AgentKind = 'cursor' | 'claude';

export interface InitTargetOptions {
  agent?: AgentKind;
  project?: boolean;
  cwd?: string;
  homeDir?: string;
}

export interface InstallAgentSkillOptions extends InitTargetOptions {
  /** Override packaged skill path (tests). */
  skillSource?: string;
}

export interface InstallAgentSkillResult {
  targetPath: string;
  updated: boolean;
  agent: AgentKind;
}

const AGENT_DIRS: Record<AgentKind, string> = {
  cursor: '.cursor',
  claude: '.claude',
};

function normalizeAgent(agent: string | undefined): AgentKind {
  const value = (agent ?? 'cursor').toLowerCase();
  if (value === 'cursor' || value === 'claude') {
    return value;
  }
  throw new Error(`Unsupported agent "${agent}". Use --agent cursor or --agent claude.`);
}

export function resolveSkillTarget(options: InitTargetOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const agent = normalizeAgent(options.agent);
  const baseDir = AGENT_DIRS[agent];

  if (options.project) {
    return path.join(cwd, baseDir, 'skills', 'deepcover', 'SKILL.md');
  }

  return path.join(homeDir, baseDir, 'skills', 'deepcover', 'SKILL.md');
}

/** Packaged skill shipped with the npm package (single source with repo Cursor skill). */
export function defaultSkillSource(): string {
  // dist/cli/commands → package root
  const packageRoot = path.resolve(__dirname, '../../..');
  return path.join(packageRoot, '.cursor', 'skills', 'deepcover', 'SKILL.md');
}

export function installAgentSkill(
  options: InstallAgentSkillOptions = {},
): InstallAgentSkillResult {
  const skillSource = options.skillSource ?? defaultSkillSource();
  if (!fs.existsSync(skillSource)) {
    throw new Error(`Skill source not found: ${skillSource}`);
  }

  const agent = normalizeAgent(options.agent);
  const targetPath = resolveSkillTarget({ ...options, agent });
  const updated = fs.existsSync(targetPath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(skillSource, targetPath);

  return { targetPath, updated, agent };
}

/** @deprecated Use installAgentSkill */
export const installCursorSkill = installAgentSkill;

export const initCommand = new Command('init')
  .description('Install the DeepCover agent skill (Cursor or Claude Code)')
  .option('--agent <name>', 'target agent: cursor | claude', 'cursor')
  .option('--project', 'install into ./.<agent>/skills (share with the repo)', false)
  .action((options: { agent?: string; project?: boolean }) => {
    try {
      const agent = normalizeAgent(options.agent);
      const result = installAgentSkill({ agent, project: options.project });
      const scope = options.project ? 'project' : 'personal';
      const verb = result.updated ? 'Updated' : 'Installed';
      const label = agent === 'claude' ? 'Claude Code' : 'Cursor';
      console.log(`${verb} ${label} skill (${scope}):`);
      console.log(`  ${result.targetPath}`);
      console.log('');
      if (agent === 'claude') {
        console.log('In Claude Code, say: "run deepcover on <module>"');
        console.log('(Restart Claude Code or /reload-skills if the skill is not picked up.)');
      } else {
        console.log('In Cursor Agent, say: "run deepcover on <module>"');
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });
