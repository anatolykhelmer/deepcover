import type { CodeModel } from '../types/code-model';
import type { ResolvedCoverage } from '../resolver/types';

export type BugPattern =
  | 'unhandled-error-path'
  | 'unchecked-nullable'
  | 'assertion-mismatch'
  | 'missing-boundary'
  | 'untested-condition-operand';

export interface BugSignal {
  pattern: BugPattern;
  className: string;
  methodName: string;
  evidence: string;
  sourceLocation: { file: string; line: number };
  confidence: number;
}

export interface BugDetector {
  readonly pattern: BugPattern;
  detect(codeModel: CodeModel, coverage: ResolvedCoverage): BugSignal[];
}
