import { group, ungroup } from '../src/grouping';

describe('ungroup', () => {
  it('turns rows into columns', () => {
    expect(ungroup([[1, 'a'], [2, 'b']])).toEqual([[1, 2], ['a', 'b']]);
  });
});

describe('group', () => {
  it('pairs same-index elements', () => {
    expect(group<number | string>([1, 2], ['a', 'b'])).toEqual([[1, 'a'], [2, 'b']]);
  });

  // The only path to ungroup's early return. A rest parameter is always an array, so this
  // never makes `!rows` true. Deleting `!rows ||` keeps every test green.
  it('returns an empty array when nothing is passed', () => {
    expect(group()).toEqual([]);
  });
});
