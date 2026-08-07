import {
  classifyMatcher,
  getAssertionSpecificity,
  getAssertionWeight,
  isMatcherModifier,
  normalizeMatcher,
} from '../matchers';

describe('matchers', () => {
  describe('classifyMatcher', () => {
    it.each(['toEqual', 'toStrictEqual', 'toBe', 'toThrow', 'toHaveBeenCalledWith'])(
      'classifies %s as strong',
      (matcher) => {
        expect(classifyMatcher(matcher)).toBe('strong');
      }
    );

    it.each(['toMatchObject', 'toBeCloseTo'])(
      'classifies %s as strong (previously absent from every list)',
      (matcher) => {
        expect(classifyMatcher(matcher)).toBe('strong');
      }
    );

    it.each(['toContain', 'toMatch', 'toHaveBeenCalledTimes', 'toHaveLength'])(
      'classifies %s as medium',
      (matcher) => {
        expect(classifyMatcher(matcher)).toBe('medium');
      }
    );

    it.each(['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeNull'])(
      'classifies %s as weak',
      (matcher) => {
        expect(classifyMatcher(matcher)).toBe('weak');
      }
    );

    it('classifies an unknown matcher as other', () => {
      expect(classifyMatcher('toBeWithinRange')).toBe('other');
    });
  });

  describe('modifier unwrapping', () => {
    it.each(['resolves', 'rejects', 'not'])('recognizes %s as a modifier', (name) => {
      expect(isMatcherModifier(name)).toBe(true);
    });

    it('does not treat a matcher as a modifier', () => {
      expect(isMatcherModifier('toEqual')).toBe(false);
    });

    it.each([
      ['resolves.toEqual', 'strong'],
      ['rejects.toThrow', 'strong'],
      ['not.toBe', 'strong'],
      ['resolves.not.toBeNull', 'weak'],
    ] as const)('classifies %s by the matcher underneath', (matcher, expected) => {
      expect(classifyMatcher(matcher)).toBe(expected);
    });

    it('yields nothing for a bare modifier', () => {
      expect(normalizeMatcher('resolves')).toBe('');
      expect(classifyMatcher('resolves')).toBe('other');
    });
  });

  describe('numeric weights', () => {
    it('weights strong above medium above everything else', () => {
      expect(getAssertionWeight('toEqual')).toBe(3);
      expect(getAssertionWeight('toContain')).toBe(2);
      expect(getAssertionWeight('toBeDefined')).toBe(1);
    });

    it('scores specificity strong 1, medium 0.6, otherwise 0.2', () => {
      expect(getAssertionSpecificity('toEqual')).toBe(1);
      expect(getAssertionSpecificity('toContain')).toBe(0.6);
      expect(getAssertionSpecificity('toBeDefined')).toBe(0.2);
    });

    it('gives a resolves-wrapped strong matcher full weight', () => {
      expect(getAssertionWeight('resolves.toEqual')).toBe(3);
      expect(getAssertionSpecificity('resolves.toEqual')).toBe(1);
    });
  });
});
