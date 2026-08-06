import path from 'path';
import { extractCodeModel } from '../index';

const TRANSITIVE_DIR = path.resolve(__dirname, '../../../fixtures/transitive');
const ASSERTION_QUALITY_DIR = path.resolve(__dirname, '../../../fixtures/assertion-quality');
const STANDALONE_FUNCTIONS_DIR = path.resolve(__dirname, '../../../fixtures/standalone-functions');

describe('extractor', () => {
  describe('fixtures/transitive', () => {
    it('returns complete CodeModel with 3 modules (one per file)', () => {
      const model = extractCodeModel({ rootDir: TRANSITIVE_DIR });
      expect(model.modules).toHaveLength(3);
      const filePaths = model.modules.map((m) => m.filePath).sort();
      expect(filePaths).toContain(path.join(TRANSITIVE_DIR, 'controller.ts'));
      expect(filePaths).toContain(path.join(TRANSITIVE_DIR, 'service.ts'));
      expect(filePaths).toContain(path.join(TRANSITIVE_DIR, 'repository.ts'));
      model.modules.forEach((mod) => {
        expect(mod.classes.length).toBeGreaterThan(0);
      });
    });

    it('dependencyGraph has injection edges (Controller→Service, Service→Repository)', () => {
      const model = extractCodeModel({ rootDir: TRANSITIVE_DIR });
      const injections = model.dependencyGraph.filter((e) => e.type === 'injection');
      const fromTo = injections.map((e) => `${e.from}→${e.to}`);
      expect(fromTo).toContain('OrderController→OrderService');
      expect(fromTo).toContain('OrderService→OrderRepository');
    });

    it('dependencyGraph has method_call edges', () => {
      const model = extractCodeModel({ rootDir: TRANSITIVE_DIR });
      const methodCalls = model.dependencyGraph.filter((e) => e.type === 'method_call');
      expect(methodCalls.length).toBeGreaterThan(0);
    });

    it('testInventory is empty (no test files in fixture)', () => {
      const model = extractCodeModel({ rootDir: TRANSITIVE_DIR });
      expect(model.testInventory.testFiles).toHaveLength(0);
      expect(Object.keys(model.testInventory.coverage)).toHaveLength(0);
    });
  });

  describe('fixtures/assertion-quality', () => {
    it('testInventory.testFiles has entries for the two .spec.ts files', () => {
      const model = extractCodeModel({ rootDir: ASSERTION_QUALITY_DIR });
      expect(model.testInventory.testFiles).toHaveLength(2);
      const filePaths = model.testInventory.testFiles.map((tf) => tf.filePath).sort();
      expect(filePaths.some((p) => p.endsWith('weak-tests.spec.ts'))).toBe(true);
      expect(filePaths.some((p) => p.endsWith('strong-tests.spec.ts'))).toBe(true);
    });

    it('testInventory.coverage maps method names to test names', () => {
      const model = extractCodeModel({ rootDir: ASSERTION_QUALITY_DIR });
      expect(model.testInventory.coverage.getAll).toBeDefined();
      expect(model.testInventory.coverage.getById).toBeDefined();
      expect(model.testInventory.coverage.create).toBeDefined();

      expect(model.testInventory.coverage.getAll).toContain('should get all items');
      expect(model.testInventory.coverage.getAll).toContain('should return all items from repository');

      expect(model.testInventory.coverage.getById).toContain('should get by id');
      expect(model.testInventory.coverage.getById).toContain('should return item by id');
      expect(model.testInventory.coverage.getById).toContain('should throw when item not found');

      expect(model.testInventory.coverage.create).toContain('should create');
      expect(model.testInventory.coverage.create).toContain('should save item via repository');
    });
  });

  describe('fixtures/standalone-functions', () => {
    it('extracts standalone exported functions into module.functions', () => {
      const model = extractCodeModel({ rootDir: STANDALONE_FUNCTIONS_DIR });
      expect(model.modules).toHaveLength(1);

      const [module] = model.modules;
      expect(module.classes).toHaveLength(0);
      expect((module.functions ?? []).map((fn) => fn.name).sort()).toEqual([
        'buildFormattedValidationErrors',
        'normalizeValidationPath',
      ]);
    });

    it('tracks standalone function coverage from test inventory', () => {
      const model = extractCodeModel({ rootDir: STANDALONE_FUNCTIONS_DIR });
      expect(model.testInventory.coverage.buildFormattedValidationErrors).toContain(
        'formats validation errors with path and message',
      );
      expect(model.testInventory.coverage.normalizeValidationPath).toContain(
        'normalizes malformed validation path',
      );
    });
  });
});
