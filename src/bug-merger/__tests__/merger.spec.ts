import { mergeBugFindings } from '../index';
import type { BugSignal } from '../../bug-detector/types';
import type { LLMBugFinding, SignalValidation } from '../types';

describe('mergeBugFindings', () => {
  it('converts deterministic signals to PotentialBugs when no LLM', () => {
    const signals: BugSignal[] = [{
      pattern: 'unhandled-error-path',
      className: 'OrderService',
      methodName: 'createOrder',
      evidence: 'catch block at line 15 with no error-path test',
      sourceLocation: { file: 'src/order.ts', line: 15 },
      confidence: 0.7,
    }];
    const result = mergeBugFindings(signals, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('deterministic');
    expect(result[0].rank).toBe(1);
    expect(result[0].pattern).toBe('unhandled-error-path');
    expect(result[0].id).toBeTruthy();
  });

  it('marks signal as hybrid when LLM confirms', () => {
    const signals: BugSignal[] = [{
      pattern: 'unhandled-error-path',
      className: 'OrderService',
      methodName: 'createOrder',
      evidence: 'catch block at line 15',
      sourceLocation: { file: 'src/order.ts', line: 15 },
      confidence: 0.6,
    }];
    const validations: SignalValidation[] = [{
      signalIndex: 0, confirmed: true, reasoning: 'Error handling is critical',
    }];
    const result = mergeBugFindings(signals, [], validations);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('hybrid');
  });

  it('demotes rejected signals to low risk', () => {
    const signals: BugSignal[] = [{
      pattern: 'missing-boundary',
      className: 'Calc',
      methodName: 'add',
      evidence: 'x > 0 at line 5',
      sourceLocation: { file: 'src/calc.ts', line: 5 },
      confidence: 0.4,
    }];
    const validations: SignalValidation[] = [{
      signalIndex: 0, confirmed: false, reasoning: 'Non-critical path',
    }];
    const result = mergeBugFindings(signals, [], validations);
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('low');
  });

  it('includes LLM-only findings', () => {
    const findings: LLMBugFinding[] = [{
      pattern: 'untested-invariant',
      className: 'PaymentService',
      methodName: 'charge',
      description: 'Amount must be positive but no test checks negative',
      risk: 'high',
      suggestedTest: 'it("should throw on negative amount")',
    }];
    const result = mergeBugFindings([], findings, []);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('llm');
    expect(result[0].pattern).toBe('untested-invariant');
  });

  it('ranks hybrid higher than single-source', () => {
    const signals: BugSignal[] = [{
      pattern: 'unhandled-error-path',
      className: 'A', methodName: 'a',
      evidence: 'catch block',
      sourceLocation: { file: 'a.ts', line: 1 }, confidence: 0.7,
    }];
    const findings: LLMBugFinding[] = [{
      pattern: 'untested-invariant',
      className: 'B', methodName: 'b',
      description: 'invariant not tested', risk: 'high',
      suggestedTest: 'test',
    }];
    const validations: SignalValidation[] = [{
      signalIndex: 0, confirmed: true, reasoning: 'confirmed',
    }];
    const result = mergeBugFindings(signals, findings, validations);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('hybrid');
    expect(result[1].source).toBe('llm');
  });
});
