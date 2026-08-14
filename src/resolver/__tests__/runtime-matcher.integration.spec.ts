import path from 'path';
import { extractCodeModel } from '../../extractor';
import { matchRuntimeTests } from '../runtime-matcher';
import { buildClassMethodOwners } from '../../types/method-owner';
import type { JestRuntimeData } from '../types';

// Task 022 regression: extractCodeModel globs with absolute: true, so the
// inventory's TestFileNode.filePath values are absolute, while Jest runtime
// results also carry absolute testFilePath values. The matcher must bring
// both into the same key space — with a real extract, runtime buckets must
// be non-empty (they silently stayed empty before the fix).
describe('matchRuntimeTests with a real extract (absolute inventory paths)', () => {
  const rootDir = path.resolve(__dirname, '../../../fixtures/assertion-quality');

  it('populates runtime buckets for tests matched via absolute Jest testFilePath', () => {
    const model = extractCodeModel({ rootDir });
    const specPath = path.join(rootDir, 'strong-tests.spec.ts');

    // Sanity: the extract really produced absolute inventory paths — if this
    // ever changes, the fixture no longer reproduces the original bug shape.
    const strongTestsFile = model.testInventory.testFiles.find((tf) =>
      tf.filePath.endsWith('strong-tests.spec.ts')
    );
    expect(strongTestsFile).toBeDefined();
    expect(path.isAbsolute(strongTestsFile!.filePath)).toBe(true);

    const runtime: JestRuntimeData = {
      testResults: [
        {
          testFilePath: specPath,
          testName: 'ItemService > should return all items from repository',
          status: 'passed',
          duration: 5,
          assertionCount: 2,
        },
        {
          testFilePath: specPath,
          testName: 'ItemService > should throw when item not found',
          status: 'failed',
          duration: 3,
          assertionCount: 1,
        },
      ],
      timestamp: '2026-01-01',
    };

    const owners = buildClassMethodOwners(model.modules);
    const result = matchRuntimeTests(runtime, model.testInventory.testFiles, rootDir, owners);

    // Runtime keys are file-qualified, matching the resolver's map keys (task 021).
    const sourceFile = path.join(rootDir, 'source.ts');
    expect(result.size).toBeGreaterThan(0);
    expect(result.get(`${sourceFile}:ItemService.getAll`)?.passed).toContain('should return all items from repository');
    expect(result.get(`${sourceFile}:ItemService.getById`)?.failed).toContain('should throw when item not found');
  });
});
