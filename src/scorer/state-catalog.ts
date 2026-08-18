import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';

export interface StateCatalogEntry {
  /** File declaring the owner. */
  filePath: string;
  /** Class name, or module filePath for standalone functions. */
  owner: string;
  methodName: string;
  /** As named by its source. */
  stateName: string;
  /** `stateName.trim().toLowerCase()` — the dedupe key component. */
  normalizedKey: string;
  provenance: 'static' | 'reasoner' | 'both';
  /** Computed once at build time; see build rules in the design spec. */
  isTested: boolean;
  /** Static entries: 1.0 (AST facts); reasoner entries: the LLM value; merged: 1.0. */
  confidence: number;
  /** Reasoner-sourced only. */
  riskIfUntested?: 'low' | 'medium' | 'high';
  /** Static-sourced only (enum values). */
  values?: string[];
}

export interface StateCatalog {
  entries: StateCatalogEntry[];
  /** Reasoner states dropped because their class is declared by several files. */
  droppedAmbiguous: number;
  /** Entries for one callable; owner/filePath qualified per task 021. */
  forMethod(owner: string, methodName: string, filePath: string): StateCatalogEntry[];
}

function normalizeStateKey(state: string): string {
  return state.trim().toLowerCase();
}

function entryKey(filePath: string, owner: string, methodName: string, normalizedKey: string): string {
  return JSON.stringify([filePath, owner, methodName, normalizedKey]);
}

/**
 * The single source of truth for domain states. Static extractor states and
 * reasoner-discovered states are unioned at state×method granularity with
 * testedness decided here, once — every scorer consumer (aggregate coverage,
 * per-method scoring, untested lists, gap generation) reads this catalog
 * rather than the raw sources (BL-001).
 */
export function buildStateCatalog(
  codeModel: CodeModel,
  reasonerOutput: ReasonerOutput,
  resolvedCoverage: ResolvedCoverage
): StateCatalog {
  const byKey = new Map<string, StateCatalogEntry>();

  for (const mod of codeModel.modules) {
    for (const cls of mod.classes) {
      for (const s of cls.states) {
        for (const methodName of s.affectedMethods) {
          const normalizedKey = normalizeStateKey(s.name);
          const key = entryKey(mod.filePath, cls.name, methodName, normalizedKey);
          const isTested = resolvedCoverage.isMethodCovered(cls.name, methodName, mod.filePath);
          const existing = byKey.get(key);
          if (existing) {
            existing.isTested = existing.isTested || isTested;
          } else {
            byKey.set(key, {
              filePath: mod.filePath,
              owner: cls.name,
              methodName,
              stateName: s.name,
              normalizedKey,
              provenance: 'static',
              isTested,
              confidence: 1,
              values: s.values,
            });
          }
        }
      }
    }
  }

  const entries = [...byKey.values()];
  return {
    entries,
    droppedAmbiguous: 0,
    forMethod(owner, methodName, filePath) {
      return entries.filter((e) => e.owner === owner && e.methodName === methodName && e.filePath === filePath);
    },
  };
}
