import type { LLMProvider } from './base';

/**
 * Mock LLM provider for testing. Returns canned, valid JSON responses
 * based on keywords in the system prompt.
 */
export class MockLLMProvider implements LLMProvider {
  async analyze(system: string, user: string): Promise<string> {
    const s = system.toLowerCase();

    if (s.includes('domain states') || s.includes('domain states that static')) {
      return this.getDomainStatesResponse(user);
    }
    if (s.includes('assertion quality') || s.includes('jest/vitest')) {
      return this.getAssertionQualityResponse(user);
    }
    if (s.includes('criticality') && s.includes('business criticality')) {
      return this.getCriticalityResponse(user);
    }
    if (s.includes('transitive coverage') || s.includes('dependency graph')) {
      return this.getTransitiveCoverageResponse(user);
    }

    // Default: return empty array
    return '[]';
  }

  private getDomainStatesResponse(user: string): string {
    const parsed = this.tryParseUser(user) as Record<string, unknown> | null;
    const classes = parsed?.classes ?? parsed;
    const items = Array.isArray(classes) ? classes : [parsed];
    const methods = this.extractMethodsFromUser(items);

    const results = methods.map((m) => ({
      className: m.className ?? 'Service',
      methodName: m.methodName ?? m.name ?? 'findAll',
      state: 'success path',
      isTested: true,
      riskIfUntested: 'medium' as const,
      confidence: 0.85,
    }));

    if (results.length === 0) {
      return JSON.stringify([
        {
          className: 'ItemService',
          methodName: 'findAll',
          state: 'empty list',
          isTested: false,
          riskIfUntested: 'low',
          confidence: 0.8,
        },
        {
          className: 'ItemService',
          methodName: 'create',
          state: 'validation failure',
          isTested: true,
          riskIfUntested: 'high',
          confidence: 0.9,
        },
      ]);
    }

    return JSON.stringify(results);
  }

  private getAssertionQualityResponse(user: string): string {
    const parsed = this.tryParseUser(user) as Record<string, unknown> | null;
    const testFiles = parsed?.testFiles ?? parsed;
    const items = Array.isArray(testFiles) ? testFiles : [parsed];
    const tests = this.extractTestsFromUser(items);

    const results = tests.map((t) => ({
      testName: t.name ?? 'should work',
      quality: 'medium' as const,
      reasoning: 'Uses value checks',
      confidence: 0.8,
    }));

    if (results.length === 0) {
      return JSON.stringify([
        {
          testName: 'should return items',
          quality: 'strong',
          reasoning: 'Verifies return value with toEqual',
          confidence: 0.9,
        },
        {
          testName: 'should create item',
          quality: 'medium',
          reasoning: 'Checks result but not side effects',
          confidence: 0.75,
        },
      ]);
    }

    return JSON.stringify(results);
  }

  private getCriticalityResponse(user: string): string {
    const parsed = this.tryParseUser(user) as Record<string, unknown> | null;
    const classes = parsed?.classes ?? parsed;
    const items = Array.isArray(classes) ? classes : [parsed];
    const methods = this.extractMethodsFromUser(items);

    const results = methods.map((m) => {
      const name = (m.methodName ?? m.name ?? '').toLowerCase();
      let criticality: 'low' | 'medium' | 'high' = 'medium';
      let reasoning = 'Standard method';
      if (name.includes('create') || name.includes('update') || name.includes('delete')) {
        criticality = 'high';
        reasoning = 'Data mutation';
      } else if (name.includes('find') || name.includes('get') || name.includes('list')) {
        criticality = 'medium';
        reasoning = 'Data read';
      } else if (name.includes('format') || name.includes('version')) {
        criticality = 'low';
        reasoning = 'Pure utility';
      }
      return {
        className: m.className ?? 'Service',
        methodName: m.methodName ?? m.name ?? 'findAll',
        criticality,
        reasoning,
        confidence: 0.85,
      };
    });

    if (results.length === 0) {
      return JSON.stringify([
        {
          className: 'ItemService',
          methodName: 'findAll',
          criticality: 'medium',
          reasoning: 'Data read and aggregation',
          confidence: 0.9,
        },
        {
          className: 'ItemService',
          methodName: 'create',
          criticality: 'high',
          reasoning: 'Data mutation with side effects',
          confidence: 0.95,
        },
      ]);
    }

    return JSON.stringify(results);
  }

  private getTransitiveCoverageResponse(user: string): string {
    const parsed = this.tryParseUser(user) as Record<string, unknown> | null;
    const edges = (parsed?.dependencyGraph ?? parsed?.edges ?? []) as Array<{ from?: string; to?: string }>;
    const edgeList = Array.isArray(edges) ? edges : [];

    const results = edgeList.slice(0, 3).map((e: { from?: string; to?: string }) => ({
      from: e.from ?? 'Controller',
      through: 'Service',
      to: e.to ?? 'Gateway',
      coveredTransitively: true,
      caveat: null as string | null,
      confidence: 0.8,
    }));

    if (results.length === 0) {
      return JSON.stringify([
        {
          from: 'OrderController',
          through: 'OrderService',
          to: 'PaymentGateway',
          coveredTransitively: false,
          caveat: 'Payment logic adds transformation',
          confidence: 0.85,
        },
      ]);
    }

    return JSON.stringify(results);
  }

  private tryParseUser(user: string): unknown {
    try {
      return JSON.parse(user);
    } catch {
      return null;
    }
  }

  private extractMethodsFromUser(items: unknown[]): Array<{ className?: string; methodName?: string; name?: string }> {
    const methods: Array<{ className?: string; methodName?: string; name?: string }> = [];
    for (const item of items) {
      const obj = item as Record<string, unknown>;
      const className = obj?.name as string | undefined;
      const methodList = obj?.methods as Array<{ name?: string }> | undefined;
      if (Array.isArray(methodList)) {
        for (const m of methodList) {
          methods.push({ className, methodName: m?.name, name: m?.name });
        }
      }
    }
    return methods;
  }

  private extractTestsFromUser(items: unknown[]): Array<{ name?: string }> {
    const tests: Array<{ name?: string }> = [];
    for (const item of items) {
      const obj = item as Record<string, unknown>;
      const describes = obj?.describes as Array<{ tests?: Array<{ name?: string }> }> | undefined;
      if (Array.isArray(describes)) {
        for (const d of describes) {
          const testList = d?.tests;
          if (Array.isArray(testList)) {
            for (const t of testList) {
              tests.push({ name: t?.name });
            }
          }
        }
      }
    }
    return tests;
  }
}
