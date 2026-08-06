import { mapIstanbulToMethod } from '../istanbul-mapper';
import type { IstanbulFileCoverage } from '../types';

describe('mapIstanbulToMethod', () => {
  const fileCoverage: IstanbulFileCoverage = {
    statementMap: {
      '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 30 } },
      '1': { start: { line: 6, column: 0 }, end: { line: 6, column: 20 } },
      '2': { start: { line: 10, column: 0 }, end: { line: 10, column: 25 } },
      '3': { start: { line: 11, column: 0 }, end: { line: 11, column: 15 } },
    },
    s: { '0': 3, '1': 3, '2': 0, '3': 0 },
    branchMap: {
      '0': { loc: { start: { line: 6 }, end: { line: 6 } }, type: 'if' },
    },
    b: { '0': [3, 0] },
    fnMap: {},
    f: {},
  };

  it('counts lines within method range as covered/total', () => {
    const result = mapIstanbulToMethod(fileCoverage, 4, 7);
    expect(result).toBeDefined();
    expect(result!.linesTotal).toBe(2);
    expect(result!.linesCovered).toBe(2);
    expect(result!.lineCoveragePercent).toBe(100);
  });

  it('counts uncovered lines correctly', () => {
    const result = mapIstanbulToMethod(fileCoverage, 9, 12);
    expect(result!.linesTotal).toBe(2);
    expect(result!.linesCovered).toBe(0);
    expect(result!.lineCoveragePercent).toBe(0);
  });

  it('counts branch hits within method range', () => {
    const result = mapIstanbulToMethod(fileCoverage, 4, 7);
    expect(result!.branchesTotal).toBe(2);
    expect(result!.branchesHit).toBe(1);
    expect(result!.branchCoveragePercent).toBe(50);
  });

  it('returns undefined when no statements fall in range', () => {
    const result = mapIstanbulToMethod(fileCoverage, 20, 30);
    expect(result).toBeUndefined();
  });
});
