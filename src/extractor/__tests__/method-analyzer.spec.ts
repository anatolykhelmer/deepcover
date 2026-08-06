import { Project, type ClassDeclaration } from 'ts-morph';
import path from 'path';
import { analyzeMethods } from '../method-analyzer';

const FIXTURE_PATH = path.join(__dirname, '../../../fixtures/branching-service/source.ts');

describe('method-analyzer', () => {
  let cls: ClassDeclaration;
  let paramToType: Map<string, string>;

  beforeAll(() => {
    const project = new Project({
      tsConfigFilePath: path.join(__dirname, '../../../tsconfig.json'),
    });
    const sourceFile = project.addSourceFileAtPath(FIXTURE_PATH);
    const branchCls = sourceFile.getClasses().find((c) => c.getName() === 'BranchingService');
    if (!branchCls) throw new Error('BranchingService not found');
    cls = branchCls;

    paramToType = new Map([
      ['db', 'DbService'],
      ['logger', 'Logger'],
    ]);
  });

  it('findById has a branch with type "guard" (if with early return)', () => {
    const methods = analyzeMethods(cls, paramToType);
    const findById = methods.find((m) => m.name === 'findById');
    expect(findById).toBeDefined();
    const guardBranch = findById!.branches.find((b) => b.type === 'guard');
    expect(guardBranch).toBeDefined();
  });

  it('processOrder has a branch with type "switch" and branchCount includes it', () => {
    const methods = analyzeMethods(cls, paramToType);
    const processOrder = methods.find((m) => m.name === 'processOrder');
    expect(processOrder).toBeDefined();
    const switchBranch = processOrder!.branches.find((b) => b.type === 'switch');
    expect(switchBranch).toBeDefined();
    expect(processOrder!.branchCount).toBeGreaterThanOrEqual(1);
  });

  it('safeSave has a branch with type "try_catch"', () => {
    const methods = analyzeMethods(cls, paramToType);
    const safeSave = methods.find((m) => m.name === 'safeSave');
    expect(safeSave).toBeDefined();
    const tryCatchBranch = safeSave!.branches.find((b) => b.type === 'try_catch');
    expect(tryCatchBranch).toBeDefined();
  });

  it('safeSave has BOTH try_catch AND if branches (nested)', () => {
    const methods = analyzeMethods(cls, paramToType);
    const safeSave = methods.find((m) => m.name === 'safeSave');
    expect(safeSave).toBeDefined();
    expect(safeSave!.branches.some((b) => b.type === 'try_catch')).toBe(true);
    expect(safeSave!.branches.some((b) => b.type === 'if')).toBe(true);
  });

  it('getLabel has a branch with type "ternary"', () => {
    const methods = analyzeMethods(cls, paramToType);
    const getLabel = methods.find((m) => m.name === 'getLabel');
    expect(getLabel).toBeDefined();
    const ternaryBranch = getLabel!.branches.find((b) => b.type === 'ternary');
    expect(ternaryBranch).toBeDefined();
  });

  it('processOrder and transferOrder have throwsErrors: true; getLabel has throwsErrors: false', () => {
    const methods = analyzeMethods(cls, paramToType);
    const processOrder = methods.find((m) => m.name === 'processOrder');
    const transferOrder = methods.find((m) => m.name === 'transferOrder');
    const getLabel = methods.find((m) => m.name === 'getLabel');
    expect(processOrder?.throwsErrors).toBe(true);
    expect(transferOrder?.throwsErrors).toBe(true);
    expect(getLabel?.throwsErrors).toBe(false);
  });

  it('transferOrder has DbService.findById, DbService.save, Logger.info', () => {
    const methods = analyzeMethods(cls, paramToType);
    const transferOrder = methods.find((m) => m.name === 'transferOrder');
    expect(transferOrder).toBeDefined();
    expect(transferOrder!.externalCalls).toContain('DbService.findById');
    expect(transferOrder!.externalCalls).toContain('DbService.save');
    expect(transferOrder!.externalCalls).toContain('Logger.info');
  });

  it('findById has hasAsyncOps: true, getLabel has hasAsyncOps: false', () => {
    const methods = analyzeMethods(cls, paramToType);
    const findById = methods.find((m) => m.name === 'findById');
    const getLabel = methods.find((m) => m.name === 'getLabel');
    expect(findById?.hasAsyncOps).toBe(true);
    expect(getLabel?.hasAsyncOps).toBe(false);
  });

  it('each branch has a human-readable condition string', () => {
    const methods = analyzeMethods(cls, paramToType);
    for (const method of methods) {
      for (const branch of method.branches) {
        expect(branch.condition).toBeDefined();
        expect(typeof branch.condition).toBe('string');
        expect(branch.condition.length).toBeGreaterThan(0);
      }
    }
  });

  it('includes startLine and endLine for each method', () => {
    const sourceCode = `
    class TestService {
      doWork(input: string): string {
        return input;
      }

      another(): void {
        console.log('hi');
      }
    }
  `;
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('test.ts', sourceCode);
    const cls = sourceFile.getClasses()[0];
    const result = analyzeMethods(cls, new Map());

    expect(result[0].startLine).toBeGreaterThan(0);
    expect(result[0].endLine).toBeGreaterThan(result[0].startLine);
    expect(result[1].startLine).toBeGreaterThan(result[0].endLine);
  });
});
