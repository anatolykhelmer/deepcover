/**
 * One taxonomy of Jest matchers, shared by every sub-score.
 *
 * Previously composer.ts, assertion-quality.ts and mutation-resilience.ts each
 * carried their own copy of these lists, which drifted: a matcher promoted in
 * one place stayed invisible in the others.
 *
 * Strength reflects how much a failing mutation would have to change for the
 * assertion to still pass:
 *   strong — pins a concrete expected value or call shape
 *   medium — pins a property of the value (membership, length, call count)
 *   weak   — pins only that *something* was produced
 */

/** Modifiers that wrap a matcher without being one. */
const MATCHER_MODIFIERS = new Set(['resolves', 'rejects', 'not']);

export const STRONG_MATCHERS = [
  'toEqual',
  'toStrictEqual',
  'toHaveBeenCalledWith',
  'toHaveBeenLastCalledWith',
  'toThrow',
  'toBe',
  'toMatchObject',
  'toBeCloseTo',
];

export const MEDIUM_MATCHERS = ['toContain', 'toMatch', 'toHaveBeenCalledTimes', 'toHaveLength'];

export const WEAK_MATCHERS = ['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeNull'];

export type MatcherStrength = 'strong' | 'medium' | 'weak' | 'other';

/** True for `resolves` / `rejects` / `not` — chain links that are not matchers. */
export function isMatcherModifier(name: string): boolean {
  return MATCHER_MODIFIERS.has(name);
}

/**
 * Strip any `resolves.` / `rejects.` / `not.` prefix so `resolves.toEqual`
 * classifies as `toEqual`.
 *
 * The extractor records the terminal matcher directly, so this is a
 * defence-in-depth pass for models produced by older extractor versions (or by
 * hand-written fixtures) that still carry the modifier in `matcherUsed`.
 */
export function normalizeMatcher(matcherUsed: string): string {
  const parts = matcherUsed.split('.');
  const terminal = parts[parts.length - 1];
  return isMatcherModifier(terminal) ? '' : terminal;
}

export function classifyMatcher(matcherUsed: string): MatcherStrength {
  const m = normalizeMatcher(matcherUsed);
  if (STRONG_MATCHERS.includes(m)) return 'strong';
  if (MEDIUM_MATCHERS.includes(m)) return 'medium';
  if (WEAK_MATCHERS.includes(m)) return 'weak';
  return 'other';
}

export function isStrongMatcher(matcherUsed: string): boolean {
  return classifyMatcher(matcherUsed) === 'strong';
}

/** Weight used by assertion quality: strong 3, medium 2, anything else 1. */
export function getAssertionWeight(matcherUsed: string): number {
  const strength = classifyMatcher(matcherUsed);
  if (strength === 'strong') return 3;
  if (strength === 'medium') return 2;
  return 1;
}

/** Specificity used by mutation resilience: strong 1, medium 0.6, anything else 0.2. */
export function getAssertionSpecificity(matcherUsed: string): number {
  const strength = classifyMatcher(matcherUsed);
  if (strength === 'strong') return 1;
  if (strength === 'medium') return 0.6;
  return 0.2;
}
