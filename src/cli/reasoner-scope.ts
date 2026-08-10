import type { ReasonerScope } from '../reasoner/scope';

/**
 * Translate the CLI's narrowing flags into the scope the Reasoner needs.
 *
 * Without `--module`/`--file` the extracted model covers the whole repository,
 * so every test file in its inventory is legitimately in scope. With either
 * flag the model holds one module's sources but still the whole repository's
 * tests, which must be filtered down before any prompt is built.
 */
export function reasonerScope(options: { module?: string; file?: string }): ReasonerScope {
  return {
    ...(options.module && { module: options.module }),
    wholeRepo: !options.module && !options.file,
  };
}
