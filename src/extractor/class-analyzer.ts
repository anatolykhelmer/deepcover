import { SourceFile, ClassDeclaration, Node, SyntaxKind } from 'ts-morph';
import type { ClassNode, MethodNode, StateNode } from '../types/code-model';
import { analyzeMethods } from './method-analyzer';

const DECORATOR_TO_TYPE: Record<string, ClassNode['type']> = {
  Injectable: 'service',
  Controller: 'controller',
  WebSocketGateway: 'gateway',
  Module: 'module',
  Dto: 'dto',
};

export function analyzeClasses(sourceFile: SourceFile): ClassNode[] {
  const classes = sourceFile.getClasses();
  return classes.map((cls) => analyzeClass(cls));
}

function analyzeClass(cls: ClassDeclaration): ClassNode {
  const name = cls.getName() ?? 'Anonymous';
  const type = detectClassType(cls);
  const dependencies = extractDependencies(cls);
  const paramNameToType = buildParamNameToType(cls, dependencies);
  const methods = analyzeMethods(cls, paramNameToType);
  const states = extractStates(cls, methods);

  return {
    name,
    type,
    methods,
    dependencies,
    states,
  };
}

function detectClassType(cls: ClassDeclaration): ClassNode['type'] {
  const decorators = cls.getDecorators();
  for (const dec of decorators) {
    const expr = dec.getExpression();
    let name: string | undefined;
    if (Node.isCallExpression(expr)) {
      name = expr.getExpression().getText();
    } else {
      // Decorator without parens: @Injectable - expr is Identifier
      name = expr.getText();
    }
    if (name && name in DECORATOR_TO_TYPE) {
      return DECORATOR_TO_TYPE[name];
    }
  }
  return 'other';
}

function extractDependencies(cls: ClassDeclaration): string[] {
  const deps: string[] = [];
  const constructors = cls.getConstructors();
  for (const ctor of constructors) {
    for (const param of ctor.getParameters()) {
      const type = param.getTypeNode();
      if (type) {
        const typeText = type.getText();
        deps.push(typeText);
      }
    }
  }
  return deps;
}

function buildParamNameToType(cls: ClassDeclaration, dependencies: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const constructors = cls.getConstructors();
  let depIndex = 0;
  for (const ctor of constructors) {
    const params = ctor.getParameters();
    for (const param of params) {
      const name = param.getName();
      const type = dependencies[depIndex] ?? param.getTypeNode()?.getText() ?? 'unknown';
      map.set(name, type);
      depIndex++;
    }
  }
  return map;
}

function extractStates(cls: ClassDeclaration, methods: MethodNode[]): StateNode[] {
  const states: StateNode[] = [];
  const sourceFile = cls.getSourceFile();
  const enums = sourceFile.getEnums();

  for (const enumDecl of enums) {
    const enumName = enumDecl.getName();
    const values = enumDecl.getMembers().map((m) => {
      const init = m.getValue();
      if (typeof init === 'string') return init;
      if (typeof init === 'number') return String(init);
      return m.getName();
    });

    const affectedMethods = methods
      .filter((m) => methodReferencesEnum(cls, m.name, enumName))
      .map((m) => m.name);

    if (affectedMethods.length > 0) {
      states.push({
        source: 'enum',
        name: enumName,
        values,
        affectedMethods,
      });
    }
  }

  return states;
}

function methodReferencesEnum(cls: ClassDeclaration, methodName: string, enumName: string): boolean {
  const method = cls.getInstanceMethod(methodName);
  if (!method) return false;

  const body = method.getBody();
  if (!body) return false;

  // AST-based check: find Identifier nodes with exact enum name (avoids false positives
  // like StatusBar, UserStatus matching "Status")
  const identifiers = body.getDescendantsOfKind(SyntaxKind.Identifier);
  return identifiers.some((id) => id.getText() === enumName);
}
