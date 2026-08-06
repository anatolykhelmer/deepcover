import {
  listParadigms,
  loadPreComputedIstanbul,
  runParadigm,
  assertParadigm,
} from './paradigm-runner';

describe('paradigm tests (unit — pre-computed Istanbul)', () => {
  const paradigms = listParadigms();

  it.each(paradigms)('paradigm: %s', (paradigmName) => {
    const istanbul = loadPreComputedIstanbul(paradigmName);
    const result = runParadigm(paradigmName, istanbul);
    assertParadigm(result);
  });
});
