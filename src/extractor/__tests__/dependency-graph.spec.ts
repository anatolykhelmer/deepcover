import { Project } from 'ts-morph';
import path from 'path';
import { analyzeClasses } from '../class-analyzer';
import { buildDependencyGraph } from '../dependency-graph';
import type { ClassNode } from '../../types/code-model';

const FIXTURES_DIR = path.join(__dirname, '../../../fixtures/transitive');

describe('dependency-graph', () => {
  let classNodes: ClassNode[];

  beforeAll(() => {
    const project = new Project({
      tsConfigFilePath: path.join(__dirname, '../../../tsconfig.json'),
    });
    const repositoryFile = project.addSourceFileAtPath(path.join(FIXTURES_DIR, 'repository.ts'));
    const serviceFile = project.addSourceFileAtPath(path.join(FIXTURES_DIR, 'service.ts'));
    const controllerFile = project.addSourceFileAtPath(path.join(FIXTURES_DIR, 'controller.ts'));

    classNodes = [
      ...analyzeClasses(repositoryFile),
      ...analyzeClasses(serviceFile),
      ...analyzeClasses(controllerFile),
    ];
  });

  describe('buildDependencyGraph', () => {
    it('creates injection edges: Controller -> Service, Service -> Repository', () => {
      const edges = buildDependencyGraph(classNodes);

      const injectionEdges = edges.filter((e) => e.type === 'injection');

      expect(injectionEdges).toContainEqual({
        from: 'OrderController',
        to: 'OrderService',
        type: 'injection',
      });
      expect(injectionEdges).toContainEqual({
        from: 'OrderService',
        to: 'OrderRepository',
        type: 'injection',
      });
    });

    it('creates method_call edges: Controller.list -> Service.getOrders, Service.getOrders -> Repository.findAll', () => {
      const edges = buildDependencyGraph(classNodes);

      const methodCallEdges = edges.filter((e) => e.type === 'method_call');

      expect(methodCallEdges).toContainEqual({
        from: 'OrderController',
        to: 'OrderService',
        type: 'method_call',
      });
      expect(methodCallEdges).toContainEqual({
        from: 'OrderService',
        to: 'OrderRepository',
        type: 'method_call',
      });
    });
  });

  describe('no false edges', () => {
    it('Controller does NOT have a direct edge to Repository', () => {
      const edges = buildDependencyGraph(classNodes);

      const directControllerToRepo = edges.filter(
        (e) => e.from === 'OrderController' && e.to === 'OrderRepository'
      );
      expect(directControllerToRepo).toHaveLength(0);
    });
  });

});
