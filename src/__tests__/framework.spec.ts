import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectFramework, missingRuntimeNote, FRAMEWORKS } from '../framework';

describe('framework detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-framework-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const withPkg = (pkg: object): string => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
    return tmpDir;
  };

  it('finds vitest in devDependencies', () => {
    expect(detectFramework(withPkg({ devDependencies: { vitest: '^4.0.0' } }))).toBe('vitest');
  });

  it('finds jest in dependencies', () => {
    expect(detectFramework(withPkg({ dependencies: { jest: '^30.0.0' } }))).toBe('jest');
  });

  it('returns undefined when neither is declared', () => {
    expect(detectFramework(withPkg({ devDependencies: { typescript: '^5.9.0' } }))).toBeUndefined();
  });

  it('returns undefined when package.json is missing', () => {
    expect(detectFramework(tmpDir)).toBeUndefined();
  });

  it('returns undefined when package.json is unparseable', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ not json');
    expect(detectFramework(tmpDir)).toBeUndefined();
  });

  // A project listing both is mid-migration; the advice that helps names the
  // runner they are moving *to*.
  it('prefers vitest when a half-migrated project lists both', () => {
    expect(
      detectFramework(withPkg({ devDependencies: { jest: '^30.0.0', vitest: '^4.0.0' } })),
    ).toBe('vitest');
  });
});

describe('missingRuntimeNote', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepcover-framework-note-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('names Vitest and its subpath for a Vitest project', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^4.0.0' } }),
    );
    const note = missingRuntimeNote(tmpDir);
    expect(note).toContain(FRAMEWORKS.vitest.reporterSpecifier);
    expect(note).not.toContain('Jest');
  });

  it('names no framework when neither runner is declared', () => {
    const note = missingRuntimeNote(tmpDir);
    expect(note).toContain('static heuristics');
    expect(note).not.toMatch(/Jest|Vitest/);
  });
});
