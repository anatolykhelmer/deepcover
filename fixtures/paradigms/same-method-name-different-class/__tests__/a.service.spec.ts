import { AService } from '../src/a.service';

describe('AService', () => {
  it('adds one', () => {
    expect(new AService().doThing(1)).toBe(2);
  });
});
