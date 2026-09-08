const path = require('path');

// The reporter is loaded from the repo's built dist/, not from src/: Jest resolves
// reporters through Node's own require, bypassing ts-jest, and Node cannot strip the
// `export =` that reporter/index.ts needs for Jest's `new require(path)()` contract.
// `npm run test:paradigms:e2e` builds first.
const REPORTER = path.resolve(__dirname, '../../dist/reporter/index.js');
const OUTPUT_DIR = process.env.DEEPCOVER_E2E_OUTPUT_DIR || '.deepcover';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageReporters: ['json'],
  reporters: ['default', [REPORTER, { outputDir: OUTPUT_DIR }]],
};
