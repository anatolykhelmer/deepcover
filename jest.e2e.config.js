module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '(paradigm-e2e|runtime-artifact-e2e)\\.spec\\.ts$',
  testPathIgnorePatterns: ['/.claude/'],

  // Serial, deliberately. Both e2e specs shell out to `npm install` for their
  // fixtures on a cold checkout, and Jest parallelises across spec FILES — so the
  // moment this regex matched a second file, two installs began racing on the
  // shared npm cache. CI failed with `Cannot read properties of null (reading
  // 'edgesOut')` from npm's arborist, in both specs at once, including the
  // paradigm stand that had been green for releases. It does not reproduce on a
  // fast machine with a warm cache, which is exactly why it is pinned here rather
  // than left to chance. These specs spawn subprocesses and gain almost nothing
  // from worker parallelism anyway.
  maxWorkers: 1,
};
