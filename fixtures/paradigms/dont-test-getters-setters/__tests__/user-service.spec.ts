import { UserService } from '../src/user-service';

describe('UserService', () => {
  const service = new UserService();

  it('should create user with correct data', () => {
    const user = service.createUser('Alice', 'alice@test.com', 30);
    expect(user.getName()).toBe('Alice');
    expect(user.getEmail()).toBe('alice@test.com');
    expect(user.getAge()).toBe(30);
  });

  it('should trim name and normalize email', () => {
    const user = service.createUser('  Bob  ', '  BOB@Test.Com  ', 25);
    expect(user.getName()).toBe('Bob');
    expect(user.getEmail()).toBe('bob@test.com');
  });

  it('should format user string', () => {
    const user = service.createUser('Bob', 'bob@test.com', 25);
    expect(service.formatUser(user)).toBe('Bob <bob@test.com>, age 25');
  });
});
