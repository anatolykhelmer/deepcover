import { Project } from 'ts-morph';
import path from 'path';
import { analyzeClasses } from '../class-analyzer';
import {
  buildDependencyGraph,
  getTransitivePaths,
  getDirectDependencies,
  getTransitiveDependencies,
} from '../dependency-graph';
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

  describe('getTransitivePaths', () => {
    it('returns paths from OrderController to OrderRepository', () => {
      const edges = buildDependencyGraph(classNodes);
      const paths = getTransitivePaths(edges, 'OrderController', 'OrderRepository');

      expect(paths).toContainEqual(['OrderController', 'OrderService', 'OrderRepository']);
    });
  });

  describe('getDirectDependencies', () => {
    it('returns immediate dependencies only', () => {
      const edges = buildDependencyGraph(classNodes);

      expect(getDirectDependencies(edges, 'OrderController')).toContain('OrderService');
      expect(getDirectDependencies(edges, 'OrderController')).not.toContain('OrderRepository');

      expect(getDirectDependencies(edges, 'OrderService')).toContain('OrderRepository');
    });
  });

  describe('getTransitiveDependencies', () => {
    it('returns all reachable dependencies', () => {
      const edges = buildDependencyGraph(classNodes);

      const controllerDeps = getTransitiveDependencies(edges, 'OrderController');
      expect(controllerDeps).toContain('OrderService');
      expect(controllerDeps).toContain('OrderRepository');
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

  describe('cycle handling', () => {
    it('does not crash or infinite loop with circular dependencies', () => {
      const cyclicEdges = [
        { from: 'A', to: 'B', type: 'injection' as const },
        { from: 'B', to: 'A', type: 'injection' as const },
      ];

      expect(() => {
        getTransitivePaths(cyclicEdges, 'A', 'B');
        getTransitivePaths(cyclicEdges, 'A', 'A');
        getTransitiveDependencies(cyclicEdges, 'A');
      }).not.toThrow();
    });
  });
});
