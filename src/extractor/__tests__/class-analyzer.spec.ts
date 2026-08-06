import { Project } from 'ts-morph';
import path from 'path';
import { analyzeClasses } from '../class-analyzer';

const FIXTURE_PATH = path.join(__dirname, '../../../fixtures/simple-service/source.ts');
const DECORATOR_NO_PARENS_PATH = path.join(__dirname, '../../../fixtures/decorator-no-parens/source.ts');

describe('class-analyzer', () => {
  let sourceFile: ReturnType<Project['addSourceFileAtPath']>;
  let decoratorNoParensFile: ReturnType<Project['addSourceFileAtPath']>;

  beforeAll(() => {
    const project = new Project({
      tsConfigFilePath: path.join(__dirname, '../../../tsconfig.json'),
    });
    sourceFile = project.addSourceFileAtPath(FIXTURE_PATH);
    decoratorNoParensFile = project.addSourceFileAtPath(DECORATOR_NO_PARENS_PATH);
  });

  it('includes undecorated classes with type "other"', () => {
    const classes = analyzeClasses(sourceFile);
    const httpService = classes.find((c) => c.name === 'HttpService');
    expect(httpService).toBeDefined();
    expect(httpService?.type).toBe('other');
  });

  it('extracts class name correctly', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    expect(simpleService).toBeDefined();
    expect(simpleService?.name).toBe('SimpleService');
  });

  it('detects class type from @Injectable() decorator', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    expect(simpleService?.type).toBe('service');
  });

  it('extracts 3 methods: findAll (public, async), getVersion (public, sync), getStatusBarInfo', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const methods = simpleService!.methods;
    expect(methods).toHaveLength(3);

    const findAll = methods.find((m) => m.name === 'findAll');
    const getVersion = methods.find((m) => m.name === 'getVersion');
    const getStatusBarInfo = methods.find((m) => m.name === 'getStatusBarInfo');

    expect(findAll).toBeDefined();
    expect(findAll?.visibility).toBe('public');
    expect(findAll?.hasAsyncOps).toBe(true);

    expect(getVersion).toBeDefined();
    expect(getVersion?.visibility).toBe('public');
    expect(getVersion?.hasAsyncOps).toBe(false);

    expect(getStatusBarInfo).toBeDefined();
    expect(getStatusBarInfo?.visibility).toBe('public');
  });

  it('findAll has at least 1 branch (the if statement)', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const findAll = simpleService!.methods.find((m) => m.name === 'findAll');
    expect(findAll).toBeDefined();
    expect(findAll!.branches.length).toBeGreaterThanOrEqual(1);
    expect(findAll!.branchCount).toBeGreaterThanOrEqual(1);
  });

  it('findAll has hasAsyncOps: true', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const findAll = simpleService!.methods.find((m) => m.name === 'findAll');
    expect(findAll?.hasAsyncOps).toBe(true);
  });

  it('findAll has external call HttpService.get', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const findAll = simpleService!.methods.find((m) => m.name === 'findAll');
    expect(findAll?.externalCalls).toContain('HttpService.get');
  });

  it('extracts HttpService as a dependency (from constructor)', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    expect(simpleService?.dependencies).toContain('HttpService');
  });

  it('detects Status enum with values [\'active\', \'inactive\'] as a state', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const statusState = simpleService!.states.find((s) => s.name === 'Status');
    expect(statusState).toBeDefined();
    expect(statusState?.source).toBe('enum');
    expect(statusState?.values).toEqual(['active', 'inactive']);
    expect(statusState?.affectedMethods).toContain('findAll');
  });

  it('detects decorator without parentheses (@Injectable)', () => {
    const classes = analyzeClasses(decoratorNoParensFile);
    const noParensService = classes.find((c) => c.name === 'NoParensService');
    expect(noParensService).toBeDefined();
    expect(noParensService?.type).toBe('service');
  });

  it('does not false-positive on enum substring matches (StatusBar vs Status)', () => {
    const classes = analyzeClasses(sourceFile);
    const simpleService = classes.find((c) => c.name === 'SimpleService');
    const statusState = simpleService!.states.find((s) => s.name === 'Status');
    expect(statusState).toBeDefined();
    expect(statusState?.affectedMethods).not.toContain('getStatusBarInfo');
  });
});
