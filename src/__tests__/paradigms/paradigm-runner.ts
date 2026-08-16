import path from 'path';
import fs from 'fs';
import { extractCodeModel } from '../../extractor';
import { resolveCoverage } from '../../resolver';
import { runScorer } from '../../scorer';
import type { ReasonerOutput } from '../../reasoner/types';
import type { ResolvedCoverage } from '../../resolver/types';
import type { ScoreResult } from '../../scorer/types';
import type { IstanbulCoverageData } from '../../resolver/types';

const PARADIGMS_DIR = path.resolve(__dirname, '../../../fixtures/paradigms');

const EMPTY_REASONER_OUTPUT: ReasonerOutput = {
  discoveredStates: [],
  assertionJudgments: [],
  criticalityRatings: [],
  transitiveInferences: [],
};

export interface ParadigmExpectations {
  paradigm: string;
  description: string;
  assertions: {
    allMethodsCovered?: boolean;
    noGapsForClass?: string;
    coveredMethods?: string[];
    /** `ClassName.methodName` entries that must NOT be covered — e.g. a same-named
     *  method on an unrelated, untested class must not inherit another class's
     *  test credit. */
    uncoveredMethods?: string[];
    expectedBugPatterns?: string[];
    /** Substrings that must each appear in the evidence of some reported bug. */
    expectedBugEvidence?: string[];
    /**
     * Patterns that must NOT be reported — the false-positive side of a paradigm, for
     * detectors whose value depends on staying quiet once the gap is actually tested.
     */
    unexpectedBugPatterns?: string[];
  };
}

export interface ParadigmResult {
  scoreResult: ScoreResult;
  resolvedCoverage: ResolvedCoverage;
  expected: ParadigmExpectations;
}

export function getParadigmFixturePath(paradigmName: string): string {
  return path.join(PARADIGMS_DIR, paradigmName);
}

export function listParadigms(): string[] {
  return fs.readdirSync(PARADIGMS_DIR).filter((name) => {
    const expectedPath = path.join(PARADIGMS_DIR, name, 'expected.json');
    return fs.existsSync(expectedPath);
  });
}

export function loadExpectations(paradigmName: string): ParadigmExpectations {
  const expectedPath = path.join(PARADIGMS_DIR, paradigmName, 'expected.json');
  return JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));
}

export function runParadigm(
  paradigmName: string,
  istanbulData: IstanbulCoverageData
): ParadigmResult {
  const fixturePath = getParadigmFixturePath(paradigmName);
  const expected = loadExpectations(paradigmName);

  const codeModel = extractCodeModel({
    rootDir: fixturePath,
    include: ['src/**/*.ts'],
    exclude: ['**/*.spec.ts', '**/*.test.ts', '**/node_modules/**'],
    testPattern: ['__tests__/**/*.spec.ts', '__tests__/**/*.test.ts'],
  });

  const resolvedCoverage = resolveCoverage(codeModel, fixturePath, {
    istanbul: istanbulData,
  });

  const enableBugs = !!(
    expected.assertions.expectedBugPatterns || expected.assertions.unexpectedBugPatterns
  );
  const scoreResult = runScorer(codeModel, EMPTY_REASONER_OUTPUT, resolvedCoverage, { enableBugs });

  return { scoreResult, resolvedCoverage, expected };
}

export function loadPreComputedIstanbul(paradigmName: string): IstanbulCoverageData {
  const fixturePath = getParadigmFixturePath(paradigmName);
  const covPath = path.join(fixturePath, '.deepcover', 'coverage-final.json');
  const raw: IstanbulCoverageData = JSON.parse(fs.readFileSync(covPath, 'utf-8'));

  // Istanbul uses absolute paths as keys. Rewrite to current machine's paths
  // so the resolver's lookup by path.resolve(rootDir, filePath) matches.
  const rewritten: IstanbulCoverageData = {};
  for (const [key, value] of Object.entries(raw)) {
    const relPath = key.replace(/^.*?\/src\//, 'src/');
    const absPath = path.resolve(fixturePath, relPath);
    rewritten[absPath] = value;
  }
  return rewritten;
}

export function loadFreshIstanbul(paradigmName: string): IstanbulCoverageData {
  const covPath = path.join(PARADIGMS_DIR, paradigmName, 'coverage', 'coverage-final.json');
  return JSON.parse(fs.readFileSync(covPath, 'utf-8'));
}

export function assertParadigm({ scoreResult, resolvedCoverage, expected }: ParadigmResult): void {
  const { assertions } = expected;

  if (assertions.allMethodsCovered) {
    for (const [qualifiedName, mc] of resolvedCoverage.methods) {
      expect(mc.isCovered).toBe(true);
    }
  }

  if (assertions.noGapsForClass) {
    const classGaps = scoreResult.gaps.filter(
      (g) => g.className === assertions.noGapsForClass
    );
    expect(classGaps).toEqual([]);
  }

  /** Paradigm assertions name methods `ClassName.method`; the declaring file
   *  comes from the resolved entry, which the accessors now require. */
  const fileOf = (qualifiedName: string): string => {
    for (const mc of resolvedCoverage.methods.values()) {
      if (mc.qualifiedName === qualifiedName) return mc.filePath;
    }
    return '';
  };

  if (assertions.coveredMethods) {
    for (const qualifiedName of assertions.coveredMethods) {
      const [className, methodName] = qualifiedName.split('.');
      const isCovered = resolvedCoverage.isMethodCovered(className, methodName, fileOf(qualifiedName));
      expect(isCovered).toBe(true);
    }
  }

  if (assertions.uncoveredMethods) {
    for (const qualifiedName of assertions.uncoveredMethods) {
      const [className, methodName] = qualifiedName.split('.');
      const isCovered = resolvedCoverage.isMethodCovered(className, methodName, fileOf(qualifiedName));
      expect(isCovered).toBe(false);

      const perMethod = scoreResult.perFunction.find(
        (f) => f.className === className && f.methodName === methodName
      );
      if (perMethod) {
        expect(perMethod.strongAssertions).toBe(0);
        expect(perMethod.mediumAssertions).toBe(0);
        expect(perMethod.weakAssertions).toBe(0);
      }
    }
  }

  if (assertions.expectedBugPatterns) {
    const foundPatterns = scoreResult.potentialBugs.map((b) => b.pattern);
    for (const expectedPattern of assertions.expectedBugPatterns) {
      expect(foundPatterns).toContain(expectedPattern);
    }
  }

  if (assertions.unexpectedBugPatterns) {
    const foundPatterns = scoreResult.potentialBugs.map((b) => b.pattern);
    for (const unexpectedPattern of assertions.unexpectedBugPatterns) {
      expect(foundPatterns).not.toContain(unexpectedPattern);
    }
  }

  if (assertions.expectedBugEvidence) {
    const evidence = scoreResult.potentialBugs.map((b) => b.evidence);
    for (const fragment of assertions.expectedBugEvidence) {
      expect(evidence.some((e) => e.includes(fragment))).toBe(true);
    }
  }
}
