import {
  listParadigms,
  loadPreComputedIstanbul,
  runParadigm,
  assertParadigm,
} from './paradigm-runner';
import { allCallables } from '../../types/callable';

describe('paradigm tests (unit — pre-computed Istanbul)', () => {
  const paradigms = listParadigms();

  it.each(paradigms)('paradigm: %s', (paradigmName) => {
    const istanbul = loadPreComputedIstanbul(paradigmName);
    const result = runParadigm(paradigmName, istanbul);
    assertParadigm(result);
  });
});

describe('guard-operand-never-short-circuits preconditions', () => {
  // The fixture's knownMissedBugPatterns asserts that the detector is silent. That only
  // means something if the detector had everything it reads: a split `||` chain on a
  // returning guard, and binary-expr counts showing the first operand never short-circuited.
  it('gives the detector a split returning guard with equal operand counts', () => {
    const name = 'guard-operand-never-short-circuits';
    const { codeModel, resolvedCoverage } = runParadigm(name, loadPreComputedIstanbul(name));

    const ungroup = codeModel.modules.flatMap((mod) => [...allCallables(mod)]).find((c) => c.node.name === 'ungroup');
    expect(ungroup).toBeDefined();
    const guard = ungroup!.node.branches.find((b) => b.operator === '||');
    expect(guard?.type).toBe('guard');
    expect(guard?.guardExit).toBe('return');
    expect(guard?.operands?.map((o) => o.text)).toEqual(['!rows', '!rows.length']);

    const coverage = resolvedCoverage.getMethodCoverage(ungroup!.owner, 'ungroup', ungroup!.filePath);
    expect(coverage?.isCovered).toBe(true);
    const counts = coverage?.istanbul?.binaryExpressions?.find((e) => e.line === guard!.lineNumber)?.pathCounts;
    expect(counts).toHaveLength(2);
    expect(counts![0]).toBeGreaterThan(0);
    expect(counts![1]).toBe(counts![0]);
  });
});
