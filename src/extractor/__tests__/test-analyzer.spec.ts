import { Project } from 'ts-morph';
import path from 'path';
import { analyzeTestFile } from '../test-analyzer';

const WEAK_TESTS_PATH = path.join(__dirname, '../../../fixtures/assertion-quality/weak-tests.spec.ts');
const STRONG_TESTS_PATH = path.join(__dirname, '../../../fixtures/assertion-quality/strong-tests.spec.ts');

function analyzeSource(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return analyzeTestFile(project.createSourceFile('sample.spec.ts', code));
}

describe('test-analyzer', () => {
  let weakTestsFile: ReturnType<Project['addSourceFileAtPath']>;
  let strongTestsFile: ReturnType<Project['addSourceFileAtPath']>;

  beforeAll(() => {
    const project = new Project({
      tsConfigFilePath: path.join(__dirname, '../../../tsconfig.json'),
    });
    weakTestsFile = project.addSourceFileAtPath(WEAK_TESTS_PATH);
    strongTestsFile = project.addSourceFileAtPath(STRONG_TESTS_PATH);
  });

  describe('describe blocks', () => {
    it('extracts correct describe block names', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const strong = analyzeTestFile(strongTestsFile);
      expect(weak.describes).toHaveLength(1);
      expect(weak.describes[0].name).toBe('ItemService');
      expect(strong.describes).toHaveLength(1);
      expect(strong.describes[0].name).toBe('ItemService');
    });
  });

  describe('test names', () => {
    it('extracts correct test names from it() calls', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const strong = analyzeTestFile(strongTestsFile);
      const weakNames = weak.describes[0].tests.map((t) => t.name);
      const strongNames = strong.describes[0].tests.map((t) => t.name);
      expect(weakNames).toContain('should get all items');
      expect(weakNames).toContain('should get by id');
      expect(weakNames).toContain('should create');
      expect(strongNames).toContain('should return all items from repository');
      expect(strongNames).toContain('should return item by id');
      expect(strongNames).toContain('should throw when item not found');
      expect(strongNames).toContain('should save item via repository');
    });
  });

  describe('assertion types', () => {
    it('categorizes toBeDefined as value_check', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const getAllTest = weak.describes[0].tests.find((t) => t.name === 'should get all items');
      const toBeDefined = getAllTest?.assertions.find((a) => a.matcherUsed === 'toBeDefined');
      expect(toBeDefined).toBeDefined();
      expect(toBeDefined?.type).toBe('value_check');
    });

    it('categorizes toBeTruthy as value_check', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const getByIdTest = weak.describes[0].tests.find((t) => t.name === 'should get by id');
      const toBeTruthy = getByIdTest?.assertions.find((a) => a.matcherUsed === 'toBeTruthy');
      expect(toBeTruthy).toBeDefined();
      expect(toBeTruthy?.type).toBe('value_check');
    });

    it('categorizes toEqual as value_check', () => {
      const strong = analyzeTestFile(strongTestsFile);
      const getAllTest = strong.describes[0].tests.find((t) => t.name === 'should return all items from repository');
      const toEqual = getAllTest?.assertions.find((a) => a.matcherUsed === 'toEqual');
      expect(toEqual).toBeDefined();
      expect(toEqual?.type).toBe('value_check');
    });

    it('categorizes toHaveBeenCalled as spy_call_count', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const createTest = weak.describes[0].tests.find((t) => t.name === 'should create');
      const toHaveBeenCalled = createTest?.assertions.find((a) => a.matcherUsed === 'toHaveBeenCalled');
      expect(toHaveBeenCalled).toBeDefined();
      expect(toHaveBeenCalled?.type).toBe('spy_call_count');
    });

    it('categorizes toHaveBeenCalledWith as called_with', () => {
      const strong = analyzeTestFile(strongTestsFile);
      const getByIdTest = strong.describes[0].tests.find((t) => t.name === 'should return item by id');
      const toHaveBeenCalledWith = getByIdTest?.assertions.find((a) => a.matcherUsed === 'toHaveBeenCalledWith');
      expect(toHaveBeenCalledWith).toBeDefined();
      expect(toHaveBeenCalledWith?.type).toBe('called_with');
    });

    it('categorizes toHaveBeenCalledTimes as spy_call_count', () => {
      const strong = analyzeTestFile(strongTestsFile);
      const getAllTest = strong.describes[0].tests.find((t) => t.name === 'should return all items from repository');
      const toHaveBeenCalledTimes = getAllTest?.assertions.find((a) => a.matcherUsed === 'toHaveBeenCalledTimes');
      expect(toHaveBeenCalledTimes).toBeDefined();
      expect(toHaveBeenCalledTimes?.type).toBe('spy_call_count');
    });

    it('categorizes rejects.toThrow as rejects', () => {
      const strong = analyzeTestFile(strongTestsFile);
      const throwTest = strong.describes[0].tests.find((t) => t.name === 'should throw when item not found');
      const toThrow = throwTest?.assertions.find((a) => a.matcherUsed === 'toThrow');
      expect(toThrow).toBeDefined();
      expect(toThrow?.type).toBe('rejects');
    });
  });

  describe('expect-chain modifiers', () => {
    function matchersIn(code: string): string[] {
      const file = analyzeSource(`describe('S', () => { it('t', async () => { ${code} }); });`);
      return file.describes[0].tests[0].assertions.map((a) => a.matcherUsed);
    }

    it('records the matcher under `resolves`, not the modifier', () => {
      expect(matchersIn('await expect(svc.charge(1)).resolves.toEqual({ ok: true });')).toEqual(['toEqual']);
    });

    it('records the matcher under `rejects`, not the modifier', () => {
      expect(matchersIn('await expect(svc.charge(1)).rejects.toThrow("boom");')).toEqual(['toThrow']);
    });

    it('records the matcher under `not`, not the modifier', () => {
      expect(matchersIn('expect(result).not.toBe(1);')).toEqual(['toBe']);
    });

    it('unwraps stacked modifiers', () => {
      expect(matchersIn('await expect(svc.charge(1)).resolves.not.toBeNull();')).toEqual(['toBeNull']);
    });

    it('categorizes any rejects chain as an error-path assertion', () => {
      const file = analyzeSource(`
        describe('S', () => {
          it('t', async () => {
            await expect(svc.charge(1)).rejects.toEqual(new Error('declined'));
          });
        });
      `);
      const assertion = file.describes[0].tests[0].assertions[0];
      expect(assertion.matcherUsed).toBe('toEqual');
      expect(assertion.type).toBe('rejects');
    });

    it('keeps `resolves` chains as value checks', () => {
      const file = analyzeSource(`
        describe('S', () => {
          it('t', async () => {
            await expect(svc.charge(1)).resolves.toEqual({ ok: true });
          });
        });
      `);
      expect(file.describes[0].tests[0].assertions[0].type).toBe('value_check');
    });
  });

  describe('assertion count', () => {
    it('weak-tests has fewer assertions than strong-tests', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const strong = analyzeTestFile(strongTestsFile);
      const weakCount = weak.describes[0].tests.reduce((sum, t) => sum + t.assertions.length, 0);
      const strongCount = strong.describes[0].tests.reduce((sum, t) => sum + t.assertions.length, 0);
      expect(weakCount).toBeLessThan(strongCount);
    });
  });

  describe('mock detection', () => {
    it('detects jest.fn() mocks and what they are assigned to', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const createTest = weak.describes[0].tests.find((t) => t.name === 'should create');
      expect(createTest?.mocks).toBeDefined();
      expect(createTest?.mocks).toContain('mockRepo.findAll');
      expect(createTest?.mocks).toContain('mockRepo.findById');
      expect(createTest?.mocks).toContain('mockRepo.save');
    });
  });

  describe('test-to-source mapping', () => {
    it('infers which method a test targets from test name or method calls', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const getAllTest = weak.describes[0].tests.find((t) => t.name === 'should get all items');
      const getByIdTest = weak.describes[0].tests.find((t) => t.name === 'should get by id');
      const createTest = weak.describes[0].tests.find((t) => t.name === 'should create');
      expect(getAllTest?.targetMethod).toBe('getAll');
      expect(getByIdTest?.targetMethod).toBe('getById');
      expect(createTest?.targetMethod).toBe('create');
    });
  });

  describe('async detection', () => {
    it('correctly identifies async test functions', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const strong = analyzeTestFile(strongTestsFile);
      expect(weak.describes[0].tests.every((t) => t.isAsync)).toBe(true);
      expect(strong.describes[0].tests.every((t) => t.isAsync)).toBe(true);
    });
  });

  describe('assertion target', () => {
    it('captures what is being asserted on in target field', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const getAllTest = weak.describes[0].tests.find((t) => t.name === 'should get all items');
      const toBeDefined = getAllTest?.assertions.find((a) => a.matcherUsed === 'toBeDefined');
      expect(toBeDefined?.target).toBe('result');
    });

    it('captures mock target for spy assertions', () => {
      const weak = analyzeTestFile(weakTestsFile);
      const createTest = weak.describes[0].tests.find((t) => t.name === 'should create');
      const toHaveBeenCalled = createTest?.assertions.find((a) => a.matcherUsed === 'toHaveBeenCalled');
      expect(toHaveBeenCalled?.target).toBe('mockRepo.save');
    });
  });

  describe('file path', () => {
    it('includes file path in result', () => {
      const weak = analyzeTestFile(weakTestsFile);
      expect(weak.filePath).toContain('weak-tests.spec.ts');
    });
  });

  describe('parameterized tests - array form', () => {
    const source = `
      describe('OrdersService', () => {
        let service: OrdersService;

        beforeEach(() => {
          service = new OrdersService();
        });

        it.each([
          ['no coupon', undefined, 200, 0],
          ['SAVE10', 'SAVE10', 200, 20],
          ['HALF', 'HALF', 200, 100],
        ])('%s: charges the discounted total', async (label, coupon, price, discount) => {
          const result = await service.createOrder('cust-1', price, coupon);
          expect(result.discount).toBe(discount);
          expect(result.total).toBe(price - discount);
        });
      });
    `;

    it('expands one entry per row with the printf tokens substituted', () => {
      const names = analyzeSource(source).describes[0].tests.map((t) => t.name);
      expect(names).toEqual([
        'no coupon: charges the discounted total',
        'SAVE10: charges the discounted total',
        'HALF: charges the discounted total',
      ]);
    });

    it('captures the assertions inside the callback for every case', () => {
      const tests = analyzeSource(source).describes[0].tests;
      expect(tests).toHaveLength(3);
      for (const test of tests) {
        expect(test.assertions.map((a) => a.matcherUsed)).toEqual(['toBe', 'toBe']);
        expect(test.targetMethod).toBe('createOrder');
        expect(test.isAsync).toBe(true);
      }
    });

    it('records the raw template and case position on each entry', () => {
      const tests = analyzeSource(source).describes[0].tests;
      expect(tests[0].parameterized).toEqual({
        form: 'array',
        titleTemplate: '%s: charges the discounted total',
        caseCount: 3,
        caseIndex: 0,
      });
      expect(tests[2].parameterized?.caseIndex).toBe(2);
    });

    it('substitutes %# with the case index', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each([[1, 2], [2, 4]])('case %#: doubles %d', (input, expected) => {
            expect(double(input)).toBe(expected);
          });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual([
        'case 0: doubles 1',
        'case 1: doubles 2',
      ]);
    });

    it('supports single-column tables where each row is one value', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each(['SAVE10', 'HALF'])('applies %s', (coupon) => {
            expect(discountFor(coupon)).toBeGreaterThan(0);
          });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual(['applies SAVE10', 'applies HALF']);
    });

    it('substitutes $-named tokens for object rows', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each([
            { coupon: 'SAVE10', total: 180 },
            { coupon: 'HALF', total: 100 },
          ])('$coupon leaves a total of $total', ({ coupon, total }) => {
            expect(apply(coupon)).toBe(total);
          });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual([
        'SAVE10 leaves a total of 180',
        'HALF leaves a total of 100',
      ]);
    });

    it('resolves $-tokens that reach into a nested object property', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each([{ user: { name: 'ann' }, out: 1 }])('$user.name scores $out', ({ user, out }) => {
            expect(score(user)).toBe(out);
          });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual(['ann scores 1']);
    });

    it('falls back to a single entry when a spread hides rows', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          const extra = [[3]];
          it.each([[1], ...extra])('handles %d', (n) => {
            expect(run(n)).toBe(n);
          });
        });
      `);
      const tests = result.describes[0].tests;
      expect(tests).toHaveLength(1);
      expect(tests[0].name).toBe('handles %d');
      expect(tests[0].assertions).toHaveLength(1);
    });

    it('resolves a table referenced by variable name', () => {
      const result = analyzeSource(`
        const CASES = [['a', 1], ['b', 2]];

        describe('Calc', () => {
          it.each(CASES)('%s maps to %d', (key, value) => {
            expect(lookup(key)).toBe(value);
          });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual(['a maps to 1', 'b maps to 2']);
    });
  });

  describe('parameterized tests - tagged template form', () => {
    const source = `
      describe('Calc', () => {
        it.each\`
          a    | b    | expected
          \${1} | \${1} | \${2}
          \${2} | \${3} | \${5}
        \`('returns $expected for $a + $b', ({ a, b, expected }) => {
          expect(add(a, b)).toBe(expected);
          expect(add(b, a)).toEqual(expected);
        });
      });
    `;

    it('expands one entry per table row with $-named tokens substituted', () => {
      const tests = analyzeSource(source).describes[0].tests;
      expect(tests.map((t) => t.name)).toEqual([
        'returns 2 for 1 + 1',
        'returns 5 for 2 + 3',
      ]);
    });

    it('captures the assertions inside the callback', () => {
      const tests = analyzeSource(source).describes[0].tests;
      for (const test of tests) {
        expect(test.assertions.map((a) => a.matcherUsed)).toEqual(['toBe', 'toEqual']);
        expect(test.targetMethod).toBe('add');
      }
    });

    it('marks the entries as template-form parameterized tests', () => {
      const tests = analyzeSource(source).describes[0].tests;
      expect(tests[0].parameterized).toEqual({
        form: 'template',
        titleTemplate: 'returns $expected for $a + $b',
        caseCount: 2,
        caseIndex: 0,
      });
    });
  });

  describe('parameterized tests - aliases and fallbacks', () => {
    it('handles test.each, xit.each, fit.each and modifier chains', () => {
      const result = analyzeSource(`
        describe('Aliases', () => {
          test.each([[1]])('test.each %d', (n) => { expect(run(n)).toBe(1); });
          xit.each([[2]])('xit.each %d', (n) => { expect(run(n)).toBe(2); });
          fit.each([[3]])('fit.each %d', (n) => { expect(run(n)).toBe(3); });
          it.only.each([[4]])('it.only.each %d', (n) => { expect(run(n)).toBe(4); });
          it.skip.each([[5]])('it.skip.each %d', (n) => { expect(run(n)).toBe(5); });
        });
      `);
      expect(result.describes[0].tests.map((t) => t.name)).toEqual([
        'test.each 1',
        'xit.each 2',
        'fit.each 3',
        'it.only.each 4',
        'it.skip.each 5',
      ]);
      expect(result.describes[0].tests.every((t) => t.assertions.length === 1)).toBe(true);
    });

    it('records a single entry when the table cannot be read statically', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each(buildCases())('handles %s', (name) => {
            expect(run(name)).toBe(true);
          });
        });
      `);
      const tests = result.describes[0].tests;
      expect(tests).toHaveLength(1);
      expect(tests[0].name).toBe('handles %s');
      expect(tests[0].parameterized).toEqual({
        form: 'array',
        titleTemplate: 'handles %s',
        caseCount: 0,
      });
      expect(tests[0].assertions).toHaveLength(1);
    });

    it('records a single entry for tables larger than the expansion cap', () => {
      const rows = Array.from({ length: 40 }, (_, i) => `[${i}]`).join(', ');
      const result = analyzeSource(`
        describe('Calc', () => {
          it.each([${rows}])('handles %d', (n) => {
            expect(run(n)).toBe(true);
          });
        });
      `);
      const tests = result.describes[0].tests;
      expect(tests).toHaveLength(1);
      expect(tests[0].name).toBe('handles %d');
      expect(tests[0].parameterized?.caseCount).toBe(40);
      expect(tests[0].parameterized?.caseIndex).toBeUndefined();
      expect(tests[0].assertions).toHaveLength(1);
    });

    it('captures tests inside a describe.each block once, with the case count', () => {
      const result = analyzeSource(`
        describe.each([
          ['SAVE10', 20],
          ['HALF', 100],
        ])('coupon %s', (coupon, discount) => {
          it('applies the discount', () => {
            expect(apply(coupon)).toBe(discount);
          });
        });
      `);
      expect(result.describes).toHaveLength(1);
      expect(result.describes[0].name).toBe('coupon %s');
      expect(result.describes[0].parameterized).toEqual({
        form: 'array',
        titleTemplate: 'coupon %s',
        caseCount: 2,
      });
      expect(result.describes[0].tests.map((t) => t.name)).toEqual(['applies the discount']);
      expect(result.describes[0].tests[0].assertions).toHaveLength(1);
    });

    it('captures tests inside a tagged-template describe.each block', () => {
      const result = analyzeSource(`
        describe.each\`
          n    | out
          \${1} | \${2}
          \${3} | \${4}
        \`('case $n', ({ n, out }) => {
          it('doubles the input', () => {
            expect(double(n)).toBe(out);
          });
        });
      `);
      expect(result.describes).toHaveLength(1);
      expect(result.describes[0].parameterized).toEqual({
        form: 'template',
        titleTemplate: 'case $n',
        caseCount: 2,
      });
      expect(result.describes[0].tests.map((t) => t.name)).toEqual(['doubles the input']);
    });

    it('captures assertions in concise arrow bodies', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it('adds', () => expect(add(1, 2)).toBe(3));
        });
      `);
      const test = result.describes[0].tests[0];
      expect(test.assertions.map((a) => a.matcherUsed)).toEqual(['toBe']);
      expect(test.targetMethod).toBe('add');
    });

    it('leaves plain it() blocks unchanged', () => {
      const result = analyzeSource(`
        describe('Calc', () => {
          it('adds two numbers', () => {
            expect(add(1, 2)).toBe(3);
          });
        });
      `);
      const test = result.describes[0].tests[0];
      expect(test.name).toBe('adds two numbers');
      expect(test.parameterized).toBeUndefined();
    });
  });

  describe('target method attribution', () => {
    const inventorySource = `
      describe('InventoryService', () => {
        let inventory: InventoryService;

        beforeEach(() => {
          inventory = new InventoryService();
        });

        it('decrements stock on a successful reservation', () => {
          inventory.seed('SKU-1', 5);

          expect(inventory.reserve('SKU-1', 2)).toBe(true);
          expect(inventory.available('SKU-1')).toBe(3);
        });

        it('restores the original quantity on release', () => {
          inventory.seed('SKU-1', 5);
          inventory.reserve('SKU-1', 2);

          inventory.release('SKU-1', 2);

          expect(inventory.available('SKU-1')).toBe(5);
        });
      });
    `;

    it('prefers the method named in the test title over the first call in the body', () => {
      const tests = analyzeSource(inventorySource).describes[0].tests;
      expect(tests.find((t) => t.name.includes('successful reservation'))?.targetMethod).toBe('reserve');
      expect(tests.find((t) => t.name.includes('on release'))?.targetMethod).toBe('release');
    });

    it('prefers the subject under test over collaborators asserted on', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;
          let inventory: InventoryService;

          beforeEach(async () => {
            const module = await Test.createTestingModule({}).compile();
            service = module.get(OrdersService);
            inventory = module.get(InventoryService);
          });

          it('decrements stock for every reserved item', async () => {
            await service.createOrder('cust-1', [{ sku: 'SKU-1', qty: 1 }]);

            expect(inventory.available('SKU-1')).toBe(9);
            expect(inventory.available('SKU-2')).toBe(7);
          });
        });
      `);
      expect(result.describes[0].tests[0].targetMethod).toBe('createOrder');
    });

    it('resolves the subject from an enclosing describe for nested blocks', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;
          let inventory: InventoryService;

          beforeEach(() => {
            service = new OrdersService();
            inventory = new InventoryService();
          });

          describe('discounts', () => {
            it('leaves the stock report untouched', async () => {
              await service.createOrder('cust-1', []);

              expect(inventory.available('SKU-1')).toBe(10);
            });
          });
        });
      `);
      const nested = result.describes.find((d) => d.name === 'discounts');
      expect(nested?.tests[0].targetMethod).toBe('createOrder');
    });

    it('looks through a test-local helper to the method it calls', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;

          beforeEach(() => {
            service = new OrdersService();
          });

          describe('discounts', () => {
            const order = (unitPrice: number, couponCode?: string) =>
              service.createOrder('cust-1', [{ unitPrice }], couponCode);

            it('rounds fractional totals to whole cents', async () => {
              const result = await order(0.335, 'SAVE10');

              expect(result.total).toBeCloseTo(0.3015, 6);
            });
          });
        });
      `);
      const nested = result.describes.find((d) => d.name === 'discounts');
      expect(nested?.tests[0].targetMethod).toBe('createOrder');
    });

    it('infers the target method for a parameterized test from the title template', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;

          beforeEach(() => {
            service = new OrdersService();
          });

          it.each([['SAVE10', 180], ['HALF', 100]])(
            '%s: createOrder charges the discounted total',
            async (coupon, total) => {
              const result = await service.createOrder('cust-1', coupon);
              expect(result.total).toBe(total);
            },
          );
        });
      `);
      expect(result.describes[0].tests.every((t) => t.targetMethod === 'createOrder')).toBe(true);
    });
  });

  describe('target class attribution', () => {
    it('resolves targetClass from a `new ClassName()` binding matching the describe name', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;

          beforeEach(() => {
            service = new OrdersService();
          });

          it('creates an order', () => {
            expect(service.createOrder('cust-1', [])).toBeDefined();
          });
        });
      `);
      expect(result.describes[0].tests[0].targetClass).toBe('OrdersService');
    });

    it('resolves targetClass from a `TestBed.inject`/`module.get` binding', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;

          beforeEach(async () => {
            const module = await Test.createTestingModule({}).compile();
            service = module.get(OrdersService);
          });

          it('creates an order', () => {
            expect(service.createOrder('cust-1', [])).toBeDefined();
          });
        });
      `);
      expect(result.describes[0].tests[0].targetClass).toBe('OrdersService');
    });

    it('resolves targetClass for a nested describe from the binding matched on an ancestor', () => {
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: OrdersService;

          beforeEach(() => {
            service = new OrdersService();
          });

          describe('discounts', () => {
            it('applies a coupon', () => {
              expect(service.createOrder('cust-1', [])).toBeDefined();
            });
          });
        });
      `);
      const nested = result.describes.find((d) => d.name === 'discounts');
      expect(nested?.tests[0].targetClass).toBe('OrdersService');
    });

    it('falls back to the outermost describe title when no construction binding is found', () => {
      // Factory-based setup: no `new ClassName()` / `TestBed.inject(ClassName)` in the
      // file, so the only available signal is the idiomatic `describe('ClassName', ...)`.
      const result = analyzeSource(`
        describe('OrdersService', () => {
          let service: any;

          beforeEach(() => {
            service = createOrdersService();
          });

          describe('#createOrder', () => {
            it('creates an order', () => {
              expect(service.createOrder('cust-1', [])).toBeDefined();
            });
          });
        });
      `);
      const nested = result.describes.find((d) => d.name === '#createOrder');
      expect(nested?.tests[0].targetClass).toBe('OrdersService');
    });

    it('falls back to its own title when a test has no ancestor describe', () => {
      const result = analyzeSource(`
        describe('formatDate', () => {
          it('formats an ISO string', () => {
            expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
          });
        });
      `);
      expect(result.describes[0].tests[0].targetClass).toBe('formatDate');
    });

    it('does not let one describe block\'s binding leak into an unrelated sibling describe', () => {
      const result = analyzeSource(`
        describe('AService', () => {
          let a: AService;
          beforeEach(() => { a = new AService(); });
          it('does the thing', () => {
            expect(a.doThing(1)).toBe(2);
          });
        });

        describe('BService', () => {
          let b: BService;
          beforeEach(() => { b = new BService(); });
          it('does the thing differently', () => {
            expect(b.doThing(1)).toBe(2);
          });
        });
      `);
      const aBlock = result.describes.find((d) => d.name === 'AService');
      const bBlock = result.describes.find((d) => d.name === 'BService');
      expect(aBlock?.tests[0].targetClass).toBe('AService');
      expect(bBlock?.tests[0].targetClass).toBe('BService');
    });
  });

  describe('target call arguments', () => {
    it('records the arguments passed to the method under test', () => {
      const result = analyzeSource(`
        describe('CalculatorController', () => {
          let controller: CalculatorController;
          beforeEach(() => { controller = new CalculatorController(); });

          it('returns the sum', () => {
            expect(controller.calculate('2', '3', 'add')).toEqual({ result: 5 });
          });
        });
      `);

      expect(result.describes[0].tests[0].targetCallArgs).toEqual(['2', '3', 'add']);
    });

    it('reaches the call inside an expect(() => ...) throw assertion', () => {
      const result = analyzeSource(`
        describe('CalculatorController', () => {
          let controller: CalculatorController;
          beforeEach(() => { controller = new CalculatorController(); });

          it('throws on non-numeric input', () => {
            expect(() => controller.calculate('foo', '3', 'add')).toThrow(BadRequestException);
          });
        });
      `);

      expect(result.describes[0].tests[0].targetCallArgs).toEqual(['foo', '3', 'add']);
    });

    it('keeps non-literal arguments as written', () => {
      const result = analyzeSource(`
        describe('OrderService', () => {
          let service: OrderService;
          beforeEach(() => { service = new OrderService(); });

          it('creates an order', async () => {
            await service.createOrder(amount, { retry: true });
          });
        });
      `);

      expect(result.describes[0].tests[0].targetCallArgs).toEqual(['amount', '{ retry: true }']);
    });

    it('records an empty list for a no-argument call', () => {
      const result = analyzeSource(`
        describe('OrderService', () => {
          let service: OrderService;
          beforeEach(() => { service = new OrderService(); });

          it('lists orders', () => {
            expect(service.listOrders()).toEqual([]);
          });
        });
      `);

      expect(result.describes[0].tests[0].targetCallArgs).toEqual([]);
    });
  });
});
