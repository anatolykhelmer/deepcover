import type { CodeModel } from '../types/code-model';
import type { ResolvedCoverage } from '../resolver/types';
import type { BugSignal, BugDetector } from './types';
import { UnhandledErrorPathDetector } from './detectors/unhandled-error-path';
import { UncheckedNullableDetector } from './detectors/unchecked-nullable';
import { AssertionMismatchDetector } from './detectors/assertion-mismatch';
import { MissingBoundaryDetector } from './detectors/missing-boundary';

export type { BugSignal } from './types';

const ALL_DETECTORS: BugDetector[] = [
  new UnhandledErrorPathDetector(),
  new UncheckedNullableDetector(),
  new AssertionMismatchDetector(),
  new MissingBoundaryDetector(),
];

function runBugDetector(codeModel: CodeModel, coverage: ResolvedCoverage): BugSignal[] {
  return ALL_DETECTORS.flatMap((d) => d.detect(codeModel, coverage));
}

export { runBugDetector };
