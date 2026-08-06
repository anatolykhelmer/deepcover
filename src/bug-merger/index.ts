import { createHash } from 'crypto';
import type { BugSignal } from '../bug-detector/types';
import type { LLMBugFinding, SignalValidation, PotentialBug } from './types';

export { mergeBugFindings };
export type { PotentialBug } from './types';

const RISK_WEIGHT = { high: 3, medium: 2, low: 1 } as const;
const SOURCE_WEIGHT = { hybrid: 3, deterministic: 2, llm: 2 } as const;

function stableId(pattern: string, className: string, methodName: string, evidence: string): string {
  const hash = createHash('sha256')
    .update(`${pattern}:${className}:${methodName}:${evidence}`)
    .digest('hex');
  return hash.slice(0, 12);
}

function signalToRisk(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

function mergeBugFindings(
  signals: BugSignal[],
  findings: LLMBugFinding[],
  validations: SignalValidation[],
): PotentialBug[] {
  const bugs: PotentialBug[] = [];
  const validationMap = new Map(validations.map((v) => [v.signalIndex, v]));

  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const validation = validationMap.get(i);

    let source: PotentialBug['source'] = 'deterministic';
    let risk = signalToRisk(signal.confidence);
    let confidence = signal.confidence;

    if (validation) {
      if (validation.confirmed) {
        source = 'hybrid';
        confidence = Math.min(confidence + 0.2, 1);
        risk = signalToRisk(confidence);
      } else {
        risk = 'low';
      }
    }

    bugs.push({
      id: stableId(signal.pattern, signal.className, signal.methodName, signal.evidence),
      rank: 0,
      className: signal.className,
      methodName: signal.methodName,
      pattern: signal.pattern,
      risk,
      description: signal.evidence,
      evidence: signal.evidence,
      suggestedTest: `Test ${signal.className}.${signal.methodName} error/edge case for ${signal.pattern}`,
      source,
    });
  }

  for (const finding of findings) {
    bugs.push({
      id: stableId(finding.pattern, finding.className, finding.methodName, finding.description),
      rank: 0,
      className: finding.className,
      methodName: finding.methodName,
      pattern: finding.pattern,
      risk: finding.risk,
      description: finding.description,
      evidence: finding.description,
      suggestedTest: finding.suggestedTest,
      source: 'llm',
    });
  }

  bugs.sort((a, b) => {
    const aScore = RISK_WEIGHT[a.risk] * SOURCE_WEIGHT[a.source];
    const bScore = RISK_WEIGHT[b.risk] * SOURCE_WEIGHT[b.source];
    return bScore - aScore;
  });

  bugs.forEach((bug, i) => {
    bug.rank = i + 1;
  });

  return bugs;
}
