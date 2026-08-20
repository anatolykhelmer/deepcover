module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: 'paradigm-e2e\\.spec\\.ts$',
  testPathIgnorePatterns: ['/.claude/'],
};
