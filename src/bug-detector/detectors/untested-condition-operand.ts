import type {
  BranchNode,
  CodeModel,
  FunctionNode,
  MethodNode,
  ParamNode,
  TestNode,
} from '../../types/code-model';
import type { BinaryExprCoverage, ResolvedCoverage } from '../../resolver/types';
import type { BugSignal, BugDetector } from '../types';
import { buildClassFileOwners, type ClassFileOwners } from '../../types/method-owner';
import { findTestsForCallable } from '../find-tests';

/** Istanbul proved the operand was never evaluated — nothing to interpret. */
const NEVER_EVALUATED_CONFIDENCE = 0.9;
/** Argument-shape inference: strong enough to raise, not to conclude. Reasoner validates. */
const NEVER_DECISIVE_CONFIDENCE = 0.4;

/**
 * Finds operands of a compound `||`/`&&` condition that no test ever exercises as the
 * deciding operand — the classic `if (a || b)` where every test enters through `a`, so
 * deleting `|| b` keeps the suite green.
 *
 * Istanbul cannot see this: its `binary-expr` counters record how often each operand was
 * *evaluated*, not how often it was *decisive*, so a guard hit only through its first
 * operand still reports as fully covered. Two independent signals are emitted:
 *
 * 1. **Never evaluated** — an operand with a zero evaluation count. This is proof, and is
 *    reported at high confidence.
 * 2. **Never decisive** — every operand was evaluated, but no test varies the input that
 *    operand reads. Istanbul's counts cannot establish this, so it is inferred from the
 *    arguments the tests pass, and emitted at low confidence for the Reasoner to confirm
 *    or reject via `signalValidations` (as `missing-boundary` does).
 */
export class UntestedConditionOperandDetector implements BugDetector {
  readonly pattern = 'untested-condition-operand' as const;

  detect(codeModel: CodeModel, coverage: ResolvedCoverage): BugSignal[] {
    const signals: BugSignal[] = [];
    const classFileOwners = buildClassFileOwners(codeModel.modules);

    for (const mod of codeModel.modules) {
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          signals.push(...this.inspect(codeModel, coverage, mod.filePath, cls.name, method, true, classFileOwners));
        }
      }
      for (const fn of mod.functions ?? []) {
        // Standalone functions are keyed by file path everywhere else in the pipeline.
        signals.push(...this.inspect(codeModel, coverage, mod.filePath, mod.filePath, fn, false, classFileOwners));
      }
    }

    return signals;
  }

  private inspect(
    codeModel: CodeModel,
    coverage: ResolvedCoverage,
    filePath: string,
    owner: string,
    method: MethodNode | FunctionNode,
    isClass: boolean,
    classFileOwners: ClassFileOwners
  ): BugSignal[] {
    const compound = method.branches.filter((b) => (b.operands?.length ?? 0) >= 2);
    if (compound.length === 0) return [];

    const methodCoverage = coverage.getMethodCoverage(owner, method.name, filePath);
    // An untested method is a coverage gap the gap generator already reports; this
    // detector is only about conditions that look covered but are not.
    if (!methodCoverage?.isCovered) return [];

    const tests = findTestsForCallable(codeModel, method.name, { owner, filePath, isClass }, classFileOwners);
    const signals: BugSignal[] = [];

    for (const branch of compound) {
      const operands = branch.operands ?? [];
      const neverEvaluated = findNeverEvaluated(branch, methodCoverage.istanbul?.binaryExpressions);

      for (const index of neverEvaluated) {
        signals.push({
          pattern: this.pattern,
          className: owner,
          methodName: method.name,
          evidence:
            `Operand ${index + 1}/${operands.length} "${operands[index].text}" of the ` +
            `${branch.operator} condition at line ${branch.lineNumber} was never evaluated by any test`,
          sourceLocation: { file: filePath, line: branch.lineNumber },
          confidence: NEVER_EVALUATED_CONFIDENCE,
        });
      }

      for (const index of findNeverDecisive(branch, method.params, tests)) {
        if (neverEvaluated.has(index)) continue;
        const operand = operands[index];
        signals.push({
          pattern: this.pattern,
          className: owner,
          methodName: method.name,
          evidence:
            `Operand ${index + 1}/${operands.length} "${operand.text}" of the guard at line ` +
            `${branch.lineNumber} is never the operand that triggers it — no test varies ` +
            `${operand.paramRefs.map((p) => `"${p}"`).join('/')}, so removing this operand ` +
            `would leave every test passing`,
          sourceLocation: { file: filePath, line: branch.lineNumber },
          confidence: NEVER_DECISIVE_CONFIDENCE,
        });
      }
    }

    return signals;
  }
}

/**
 * Operand positions Istanbul recorded zero evaluations for.
 *
 * The mapping to Istanbul's paths only holds when exactly one `binary-expr` starts on the
 * branch's line and reports one path per operand — a nested chain of the other operator
 * gets its own entry, and rather than guess which is which, an ambiguous line is skipped.
 */
function findNeverEvaluated(
  branch: BranchNode,
  binaryExpressions: BinaryExprCoverage[] | undefined
): Set<number> {
  const operandCount = branch.operands?.length ?? 0;
  const onLine = (binaryExpressions ?? []).filter((e) => e.line === branch.lineNumber);
  if (onLine.length !== 1) return new Set();

  const { pathCounts } = onLine[0];
  if (pathCounts.length !== operandCount) return new Set();
  // A zero on the first operand means the condition itself was never reached — that is
  // missing branch coverage, which Istanbul already reports on its own.
  if (pathCounts[0] === 0) return new Set();

  const unevaluated = new Set<number>();
  pathCounts.forEach((count, index) => {
    if (count === 0) unevaluated.add(index);
  });
  return unevaluated;
}

/**
 * Operand positions that are evaluated but never decide the branch.
 *
 * The only static evidence of which operand a test targets is which argument it varies:
 * a test that reaches the throw while passing the happy-path value for everything but
 * `bRaw` can only have triggered it through an operand that reads `bRaw`. That needs an
 * observable outcome to partition tests by, so this is limited to guards that throw —
 * tests asserting a throw are the ones that entered the guard, the rest are the baseline
 * they are compared against. Guards that `return` and plain `if`s carry no such signal
 * and are left to the Reasoner.
 */
function findNeverDecisive(branch: BranchNode, params: ParamNode[], tests: TestNode[]): number[] {
  if (branch.type !== 'guard' || branch.guardExit !== 'throw') return [];
  const operands = branch.operands ?? [];

  const withArgs = tests.filter((t) => t.targetCallArgs !== undefined);
  const entering = withArgs.filter(hasErrorAssertion);
  const baseline = withArgs.filter((t) => !hasErrorAssertion(t));
  if (entering.length === 0 || baseline.length === 0) return [];

  const variedPositions = new Set<number>();
  for (const test of entering) {
    for (const position of nearestDifferingPositions(test, baseline)) {
      variedPositions.add(position);
    }
  }
  if (variedPositions.size === 0) return [];

  const positionByParam = new Map(params.map((p, i) => [p.name, i]));
  const decidable = operands.map((o) => o.paramRefs.some((ref) => positionByParam.has(ref)));
  const targeted = operands.map((o, i) =>
    decidable[i] && o.paramRefs.some((ref) => variedPositions.has(positionByParam.get(ref) as number))
  );

  // With no operand targeted, the tests entered this guard some way we cannot see (or not
  // at all) — reporting every operand would be noise rather than a finding.
  if (!targeted.some(Boolean)) return [];

  const untargeted: number[] = [];
  operands.forEach((_, index) => {
    if (decidable[index] && !targeted[index]) untargeted.push(index);
  });
  return untargeted;
}

function hasErrorAssertion(test: TestNode): boolean {
  return test.assertions.some((a) => a.type === 'throws' || a.type === 'rejects');
}

/**
 * Argument positions a test changes relative to the closest baseline call — the fewest
 * changes, so a suite with several happy-path variants still isolates what a given test
 * is really varying.
 */
function nearestDifferingPositions(test: TestNode, baseline: TestNode[]): number[] {
  const args = test.targetCallArgs ?? [];
  let nearest: number[] | null = null;

  for (const other of baseline) {
    const otherArgs = other.targetCallArgs ?? [];
    const differing: number[] = [];
    for (let i = 0; i < Math.max(args.length, otherArgs.length); i++) {
      if (args[i] !== otherArgs[i]) differing.push(i);
    }
    if (nearest === null || differing.length < nearest.length) nearest = differing;
  }

  return nearest ?? [];
}

