import { Project } from 'ts-morph';
import path from 'path';
import { analyzeTestFile } from '../test-analyzer';

const WEAK_TESTS_PATH = path.join(__dirname, '../../../fixtures/assertion-quality/weak-tests.spec.ts');
const STRONG_TESTS_PATH = path.join(__dirname, '../../../fixtures/assertion-quality/strong-tests.spec.ts');

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
});
