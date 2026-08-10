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

  describe('binary-expr paths', () => {
    // `a || b || c || d` where every operand was evaluated but the last one decided
    // nothing — the aggregate counters above flatten this away entirely.
    const withBinaryExpr: IstanbulFileCoverage = {
      statementMap: { '0': { start: { line: 5, column: 0 }, end: { line: 5, column: 30 } } },
      s: { '0': 3 },
      branchMap: {
        '0': { loc: { start: { line: 5 }, end: { line: 5 } }, type: 'if' },
        '1': { loc: { start: { line: 5 }, end: { line: 5 } }, type: 'binary-expr' },
        '2': { loc: { start: { line: 40 }, end: { line: 40 } }, type: 'binary-expr' },
      },
      b: { '0': [1, 2], '1': [3, 3, 3, 2], '2': [1, 1] },
      fnMap: {},
      f: {},
    };

    it('keeps the per-operand counts of binary expressions in range', () => {
      const result = mapIstanbulToMethod(withBinaryExpr, 4, 7);
      expect(result!.binaryExpressions).toEqual([{ line: 5, pathCounts: [3, 3, 3, 2] }]);
    });

    it('leaves the aggregate branch counters untouched', () => {
      const result = mapIstanbulToMethod(withBinaryExpr, 4, 7);
      expect(result!.branchesTotal).toBe(6);
      expect(result!.branchesHit).toBe(6);
      expect(result!.branchCoveragePercent).toBe(100);
    });

    it('is empty when the method has no binary expressions', () => {
      const result = mapIstanbulToMethod(fileCoverage, 4, 7);
      expect(result!.binaryExpressions).toEqual([]);
    });
  });
});
