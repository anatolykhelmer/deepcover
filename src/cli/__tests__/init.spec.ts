import fs from 'fs';
import path from 'path';
import os from 'os';
import { installAgentSkill, resolveSkillTarget } from '../commands/init';

describe('resolveSkillTarget', () => {
  it('defaults to personal ~/.cursor/skills/deepcover (agent cursor)', () => {
    const target = resolveSkillTarget({
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/Users/me', '.cursor', 'skills', 'deepcover', 'SKILL.md'));
  });

  it('uses project .cursor/skills when project is true and agent is cursor', () => {
    const target = resolveSkillTarget({
      project: true,
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/proj', '.cursor', 'skills', 'deepcover', 'SKILL.md'));
  });

  it('uses personal ~/.claude/skills when agent is claude', () => {
    const target = resolveSkillTarget({
      agent: 'claude',
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/Users/me', '.claude', 'skills', 'deepcover', 'SKILL.md'));
  });

  it('uses project .claude/skills when agent is claude and project is true', () => {
    const target = resolveSkillTarget({
      agent: 'claude',
      project: true,
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/proj', '.claude', 'skills', 'deepcover', 'SKILL.md'));
  });

  it('throws for unsupported agent', () => {
    expect(() =>
      resolveSkillTarget({
        // force an invalid value at runtime
        agent: 'windsurf' as unknown as 'cursor',
        homeDir: '/Users/me',
        cwd: '/proj',
      }),
    ).toThrow(/unsupported agent/i);
  });
});

describe('installAgentSkill', () => {
  let tmpDir: string;
  let skillSource: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-init-'));
    skillSource = path.join(tmpDir, 'source', 'SKILL.md');
    homeDir = path.join(tmpDir, 'home');
    projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(path.dirname(skillSource), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(skillSource, '# DeepCover skill\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs skill into personal cursor skills dir by default', () => {
    const result = installAgentSkill({
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(homeDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(result.agent).toBe('cursor');
    expect(result.updated).toBe(false);
    expect(fs.readFileSync(expected, 'utf-8')).toBe('# DeepCover skill\n');
  });

  it('installs skill into project cursor when project is true', () => {
    const result = installAgentSkill({
      project: true,
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(projectDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(result.agent).toBe('cursor');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('installs skill into personal claude skills dir', () => {
    const result = installAgentSkill({
      agent: 'claude',
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(homeDir, '.claude', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(result.agent).toBe('claude');
    expect(fs.readFileSync(expected, 'utf-8')).toBe('# DeepCover skill\n');
  });

  it('installs skill into project claude when project is true', () => {
    const result = installAgentSkill({
      agent: 'claude',
      project: true,
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(projectDir, '.claude', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(result.agent).toBe('claude');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('reports updated when target already exists', () => {
    const target = path.join(homeDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'old\n');

    const result = installAgentSkill({
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    expect(result.updated).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('# DeepCover skill\n');
  });

  it('throws when skill source is missing', () => {
    expect(() =>
      installAgentSkill({
        skillSource: path.join(tmpDir, 'missing.md'),
        homeDir,
        cwd: projectDir,
      }),
    ).toThrow(/skill source not found/i);
  });
});
