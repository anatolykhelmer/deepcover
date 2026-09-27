import {
  listParadigms,
  loadPreComputedIstanbul,
  runParadigm,
  assertParadigm,
  assertNeverShortCircuitsPreconditions,
  NEVER_SHORT_CIRCUITS_PARADIGM,
} from './paradigm-runner';

describe('paradigm tests (unit — pre-computed Istanbul)', () => {
  const paradigms = listParadigms();

  it.each(paradigms)('paradigm: %s', (paradigmName) => {
    const istanbul = loadPreComputedIstanbul(paradigmName);
    const result = runParadigm(paradigmName, istanbul);
    assertParadigm(result);
  });
});

describe('guard-operand-never-short-circuits preconditions', () => {
  it('gives the detector a split returning guard with equal operand counts', () => {
    const name = NEVER_SHORT_CIRCUITS_PARADIGM;
    assertNeverShortCircuitsPreconditions(runParadigm(name, loadPreComputedIstanbul(name)));
  });
});
