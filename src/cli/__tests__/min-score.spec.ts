import { resolveMinScore } from '../min-score';
import type { DeepCoverConfig } from '../config';

const NO_THRESHOLD: DeepCoverConfig = { reasoner: { provider: 'mock' } };
const GATED_AT_60: DeepCoverConfig = { thresholds: { composite: 60 } };

describe('resolveMinScore', () => {
  it('returns the config threshold when no flag is given', () => {
    expect(resolveMinScore(undefined, GATED_AT_60)).toBe(60);
  });

  it('lets the flag beat the config threshold', () => {
    expect(resolveMinScore('80', GATED_AT_60)).toBe(80);
  });

  it('returns undefined — no gate at all — when neither is set', () => {
    // Not 0: a gate at 0 would still be a gate, and `composite < 0` never firing
    // is an accident of the range rather than an expression of intent.
    expect(resolveMinScore(undefined, NO_THRESHOLD)).toBeUndefined();
  });

  it('returns the flag when there is no config threshold', () => {
    expect(resolveMinScore('0', NO_THRESHOLD)).toBe(0);
  });

  /**
   * The flag suppresses the config threshold, so a flag that does not parse must
   * throw rather than resolve to something weaker. Every case below would
   * otherwise hand back a number that silently under-gates or no gate at all.
   */
  describe('malformed flag', () => {
    it.each([
      ['8O', "a digit-then-letter typo parseInt would read as 8"],
      ['abc', 'no leading digits at all'],
      ['60abc', 'trailing garbage parseInt would truncate away'],
      ['', 'an empty value Number() would read as 0'],
      ['  ', 'whitespace only'],
      ['NaN', 'the literal string'],
      ['Infinity', 'not a score'],
    ])('throws on %p (%s)', (flag) => {
      expect(() => resolveMinScore(flag, GATED_AT_60)).toThrow(/--min-score expects a number/);
    });

    it('names the offending value so the user can see the typo', () => {
      expect(() => resolveMinScore('8O', GATED_AT_60)).toThrow("--min-score expects a number, got '8O'");
    });

    it('still accepts a fractional threshold', () => {
      expect(resolveMinScore('59.5', GATED_AT_60)).toBe(59.5);
    });
  });
});
