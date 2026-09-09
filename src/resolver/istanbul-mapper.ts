import type {
  BinaryExprCoverage,
  CoverageProviderId,
  IstanbulCoverageData,
  IstanbulFileCoverage,
  IstanbulMethodMetrics,
} from './types';

/**
 * Whether this coverage artifact carries per-operand (`binary-expr`) branch data.
 *
 * Istanbul always measures operands, so its id is trusted directly — otherwise a project
 * that simply has no compound conditions would be misread as unmeasured. Every other
 * provider is judged by what it actually emitted: `@vitest/coverage-v8` 4.x remaps v8
 * output through the AST and does produce `binary-expr` branches, while Jest's
 * v8-to-istanbul does not. Both report `coverageProvider: 'v8'`, so asking the data is
 * the only way to tell them apart.
 *
 * Residual imprecision, accepted deliberately: a project with no compound conditions at
 * all under a non-Istanbul provider is classified "does not measure". The operand
 * detector has nothing to work with either way, so the misclassification is inert.
 */
export function artifactMeasuresOperands(
  provider: CoverageProviderId,
  data: IstanbulCoverageData
): boolean {
  if (provider === 'istanbul') return true;
  for (const file of Object.values(data)) {
    for (const branch of Object.values(file.branchMap)) {
      if (branch.type === 'binary-expr') return true;
    }
  }
  return false;
}

export function mapIstanbulToMethod(
  fileCoverage: IstanbulFileCoverage,
  startLine: number,
  endLine: number,
  measuresOperands: boolean
): IstanbulMethodMetrics | undefined {
  let linesTotal = 0;
  let linesCovered = 0;

  for (const [id, loc] of Object.entries(fileCoverage.statementMap)) {
    if (loc.start.line >= startLine && loc.end.line <= endLine) {
      linesTotal += 1;
      if (fileCoverage.s[id] > 0) linesCovered += 1;
    }
  }

  if (linesTotal === 0) return undefined;

  let branchesTotal = 0;
  let branchesHit = 0;
  const binaryExpressions: BinaryExprCoverage[] = [];

  for (const [id, branch] of Object.entries(fileCoverage.branchMap)) {
    if (branch.loc.start.line >= startLine && branch.loc.end.line <= endLine) {
      const arms = fileCoverage.b[id] ?? [];
      for (const armCount of arms) {
        branchesTotal += 1;
        if (armCount > 0) branchesHit += 1;
      }
      if (branch.type === 'binary-expr' && measuresOperands) {
        binaryExpressions.push({ line: branch.loc.start.line, pathCounts: [...arms] });
      }
    }
  }

  return {
    linesCovered,
    linesTotal,
    lineCoveragePercent: (linesCovered / linesTotal) * 100,
    branchesHit,
    branchesTotal,
    branchCoveragePercent: branchesTotal > 0 ? (branchesHit / branchesTotal) * 100 : 100,
    // Genuinely absent (not present-and-undefined) when the provider that produced this
    // artifact does not record per-operand counts — see `artifactMeasuresOperands`.
    ...(measuresOperands && { binaryExpressions }),
  };
}
