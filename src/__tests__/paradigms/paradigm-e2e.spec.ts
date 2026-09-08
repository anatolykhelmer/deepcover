import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  listParadigms,
  getParadigmFixturePath,
  loadFreshIstanbul,
  runParadigm,
  assertParadigm,
} from './paradigm-runner';

jest.setTimeout(120000);

const RUNNERS = [
  { framework: 'jest', command: 'npx jest --coverage' },
  { framework: 'vitest', command: 'npx vitest run --coverage' },
] as const;

/**
 * Paradigms excluded from the VITEST half of the matrix only.
 *
 * `bug-unhandled-error`'s fixture spec (`__tests__/order.service.spec.ts`) uses Jest's
 * global mock API — `jest.fn()`, `.mockResolvedValue()`, `jest.Mocked<OrderRepository>`.
 * Vitest's `globals: true` provides `vi`, not a `jest` alias, so that spec throws
 * `ReferenceError: jest is not defined` under Vitest. This is a fact about the two
 * frameworks' mocking APIs differing, not a limitation of DeepCover's analysis —
 * DeepCover's support for Vitest's `vi.*` mock API is covered separately by unit tests
 * in src/extractor/__tests__/test-analyzer.spec.ts. Rewriting the fixture to a
 * framework-neutral mock would change which matcher class DeepCover scores
 * (`toHaveBeenCalledTimes` vs. hand-rolled counting) and silently invalidate this
 * fixture's expected.json; a separate `vi.*` twin spec can't work either without
 * teaching paradigm-runner's extractor to tell the two specs apart, since its
 * testPattern (all `.spec.ts` files under __tests__) would otherwise ingest both into
 * one code model. So: excluded here, not fixed, forked, or shimmed.
 */
const VITEST_EXCLUDED_PARADIGMS = new Set(['bug-unhandled-error']);

describe.each(RUNNERS)('paradigm tests (e2e — real $framework run)', ({ framework, command }) => {
  const paradigms = listParadigms();
  const runnableParadigms =
    framework === 'vitest'
      ? paradigms.filter((name) => !VITEST_EXCLUDED_PARADIGMS.has(name))
      : paradigms;
  const skippedParadigms =
    framework === 'vitest'
      ? paradigms.filter((name) => VITEST_EXCLUDED_PARADIGMS.has(name))
      : [];

  it.each(runnableParadigms)('paradigm: %s', (paradigmName) => {
    const fixturePath = getParadigmFixturePath(paradigmName);

    if (!fs.existsSync(path.join(fixturePath, 'node_modules'))) {
      // `npm ci`, not `npm install`: the fixtures carry committed lockfiles so the
      // e2e stand resolves the same dependency graph on every run. It also sidesteps
      // an arborist peer-resolution crash (`edgesOut` of null) that npm <= 11.0.0 hits
      // when building an ideal tree for a nested project — which broke CI on unchanged
      // code once the registry drifted under it.
      execSync('npm ci', { cwd: fixturePath, stdio: 'pipe' });
    }

    execSync(command, { cwd: fixturePath, stdio: 'pipe' });

    // Same expected.json for both runners — that shared file is the parity assertion.
    assertParadigm(runParadigm(paradigmName, loadFreshIstanbul(paradigmName)));
  });

  // Enumerated (not omitted) so the Vitest run visibly reports this case as skipped —
  // see VITEST_EXCLUDED_PARADIGMS above for why. A silently absent case would read as
  // full parity proven on every paradigm, which is not what this run shows.
  if (skippedParadigms.length > 0) {
    it.skip.each(skippedParadigms)(
      'paradigm: %s (skipped — Jest-only mock API, see VITEST_EXCLUDED_PARADIGMS)',
      () => {}
    );
  }
});
