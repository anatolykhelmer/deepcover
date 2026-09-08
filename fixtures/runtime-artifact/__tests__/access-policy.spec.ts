import { AccessPolicy } from '../src/access-policy';

describe('AccessPolicy', () => {
  let policy: AccessPolicy;

  beforeEach(() => {
    policy = new AccessPolicy();
  });

  it('allows an active admin', () => {
    expect(policy.allows('admin', true, 0)).toBe(true);
  });

  it('falls back to the quota for a non-admin', () => {
    expect(policy.allows('user', true, 5)).toBe(true);
  });
});
