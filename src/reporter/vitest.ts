/**
 * Vitest resolves a custom reporter as a module and accepts a named or default
 * export, so this needs none of the `export =` gymnastics `reporter/index.ts`
 * performs for Jest's `require(path)` + `new Reporter()` contract.
 */
export { DeepCoverVitestReporter } from './vitest-reporter';
export { DeepCoverVitestReporter as default } from './vitest-reporter';
