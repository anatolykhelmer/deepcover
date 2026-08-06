import fs from 'fs';
import path from 'path';
import os from 'os';
import { installCursorSkill, resolveSkillTarget } from '../commands/init';

describe('resolveSkillTarget', () => {
  it('defaults to personal ~/.cursor/skills/deepcover', () => {
    const target = resolveSkillTarget({
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/Users/me', '.cursor', 'skills', 'deepcover', 'SKILL.md'));
  });

  it('uses project .cursor/skills when project is true', () => {
    const target = resolveSkillTarget({
      project: true,
      homeDir: '/Users/me',
      cwd: '/proj',
    });
    expect(target).toBe(path.join('/proj', '.cursor', 'skills', 'deepcover', 'SKILL.md'));
  });
});

describe('installCursorSkill', () => {
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

  it('installs skill into personal skills dir', () => {
    const result = installCursorSkill({
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(homeDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(result.updated).toBe(false);
    expect(fs.readFileSync(expected, 'utf-8')).toBe('# DeepCover skill\n');
  });

  it('installs skill into project when project is true', () => {
    const result = installCursorSkill({
      project: true,
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    const expected = path.join(projectDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    expect(result.targetPath).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('reports updated when target already exists', () => {
    const target = path.join(homeDir, '.cursor', 'skills', 'deepcover', 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'old\n');

    const result = installCursorSkill({
      skillSource,
      homeDir,
      cwd: projectDir,
    });

    expect(result.updated).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('# DeepCover skill\n');
  });

  it('throws when skill source is missing', () => {
    expect(() =>
      installCursorSkill({
        skillSource: path.join(tmpDir, 'missing.md'),
        homeDir,
        cwd: projectDir,
      }),
    ).toThrow(/skill source not found/i);
  });
});
