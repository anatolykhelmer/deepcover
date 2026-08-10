import type { BinaryExprCoverage, IstanbulFileCoverage, IstanbulMethodMetrics } from './types';

export function mapIstanbulToMethod(
  fileCoverage: IstanbulFileCoverage,
  startLine: number,
  endLine: number
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
      if (branch.type === 'binary-expr') {
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
    binaryExpressions,
  };
}
