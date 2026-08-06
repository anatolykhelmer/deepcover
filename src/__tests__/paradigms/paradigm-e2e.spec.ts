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

jest.setTimeout(30000);

describe('paradigm tests (e2e — real Jest run)', () => {
  const paradigms = listParadigms();

  it.each(paradigms)('paradigm: %s', (paradigmName) => {
    const fixturePath = getParadigmFixturePath(paradigmName);

    const nodeModulesExist = fs.existsSync(
      path.join(fixturePath, 'node_modules')
    );
    if (!nodeModulesExist) {
      execSync('npm install', { cwd: fixturePath, stdio: 'pipe' });
    }

    execSync('npx jest --coverage', { cwd: fixturePath, stdio: 'pipe' });

    const istanbul = loadFreshIstanbul(paradigmName);
    const result = runParadigm(paradigmName, istanbul);
    assertParadigm(result);
  });
});
