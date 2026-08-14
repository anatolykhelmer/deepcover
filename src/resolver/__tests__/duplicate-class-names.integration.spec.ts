import path from 'path';
import { extractCodeModel } from '../../extractor';
import { resolveCoverage } from '../index';

// Task 021 regression: two modules that both export `class OrderService { create() }`.
// Class methods used to be keyed as bare `ClassName.methodName`, so the second
// module overwrote the first in ResolvedCoverage and all static credit merged
// onto the surviving entry. Keys must be file-qualified so both classes appear,
// and only the file the tests actually import gets the credit.
describe('resolveCoverage with duplicate class names across files', () => {
  const rootDir = path.resolve(__dirname, '../../../fixtures/duplicate-class-names');

  it('keeps both same-named classes under distinct keys with per-file static credit', () => {
    const model = extractCodeModel({ rootDir });
    const resolved = resolveCoverage(model, rootDir);

    const entries = [...resolved.methods.values()].filter(
      (mc) => mc.className === 'OrderService' && mc.methodName === 'create'
    );
    expect(entries).toHaveLength(2);

    const aEntry = entries.find((e) => e.filePath.includes(`${path.sep}a${path.sep}`));
    const bEntry = entries.find((e) => e.filePath.includes(`${path.sep}b${path.sep}`));
    expect(aEntry).toBeDefined();
    expect(bEntry).toBeDefined();

    // a/ has a spec importing its own OrderService; b/ has no tests at all.
    expect(aEntry!.staticTests).toContain('should create order');
    expect(aEntry!.isCovered).toBe(true);
    expect(bEntry!.staticTests).toHaveLength(0);
    expect(bEntry!.isCovered).toBe(false);
  });
});
