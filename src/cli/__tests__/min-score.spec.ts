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

  /**
   * The composite is always 0..100 and `thresholds.composite` is bounded to the
   * same range by the config schema, so the flag that *overrides* the config
   * must not accept what the config would reject. An out-of-range flag still
   * suppresses the configured threshold, so accepting it silently replaces a
   * real gate with one that can never fire.
   */
  describe('out-of-range flag', () => {
    it.each([
      ['-5', 'a gate below 0 no composite can ever fall under — suppresses the config gate and always passes'],
      ['-0.5', 'just under the lower bound'],
      ['101', 'a gate above 100 no composite can ever reach — always fails'],
      ['100.5', 'just over the upper bound'],
      ['1000', 'far above the range'],
    ])('throws on %p (%s)', (flag) => {
      expect(() => resolveMinScore(flag, GATED_AT_60)).toThrow(
        /--min-score expects a number between 0 and 100/,
      );
    });

    it('names the offending value so the user can see what was rejected', () => {
      expect(() => resolveMinScore('-5', GATED_AT_60)).toThrow(
        "--min-score expects a number between 0 and 100, got '-5'",
      );
    });

    it('describes the two directions by their opposite consequences', () => {
      // Conflating them buries the dangerous one: a negative gate is the silent
      // pass this function exists to prevent, not a gate that "can never be met".
      expect(() => resolveMinScore('-5', GATED_AT_60)).toThrow(/can never fire/);
      expect(() => resolveMinScore('-5', GATED_AT_60)).toThrow(/would pass/);
      expect(() => resolveMinScore('101', GATED_AT_60)).toThrow(/can never pass/);
      expect(() => resolveMinScore('101', GATED_AT_60)).toThrow(/would fail/);
    });

    it('accepts the lower boundary 0 — a deliberate "never gate" setting', () => {
      expect(resolveMinScore('0', GATED_AT_60)).toBe(0);
    });

    it('accepts the upper boundary 100 — a deliberate "must be perfect" setting', () => {
      expect(resolveMinScore('100', GATED_AT_60)).toBe(100);
    });
  });
});
