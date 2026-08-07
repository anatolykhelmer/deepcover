import { DeepCoverReporter } from './jest-reporter';

/**
 * Jest resolves a custom reporter with `const Reporter = require(path)` and then
 * calls `new Reporter(globalConfig, options)`, so this entry point must export the
 * class as `module.exports` itself — a named export alone yields
 * "Reporter is not a constructor".
 *
 * The named and default properties are re-attached so that
 * `import { DeepCoverReporter } from '@anatolykhelmer/deep-cover/reporter'` and
 * Jest's `.default` fallback keep working against the same class.
 */
type DeepCoverReporterConstructor = typeof DeepCoverReporter;

interface DeepCoverReporterEntry extends DeepCoverReporterConstructor {
  DeepCoverReporter: DeepCoverReporterConstructor;
  default: DeepCoverReporterConstructor;
}

const entry = DeepCoverReporter as DeepCoverReporterEntry;
entry.DeepCoverReporter = DeepCoverReporter;
entry.default = DeepCoverReporter;

export = entry;
