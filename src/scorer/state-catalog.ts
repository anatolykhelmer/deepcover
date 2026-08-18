import type { CodeModel } from '../types/code-model';
import type { ReasonerOutput } from '../reasoner/types';
import type { ResolvedCoverage } from '../resolver/types';
import { buildClassFileOwners, resolveReasonerOwnerFile } from '../types/method-owner';

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
  /**
   * Static entries: 1.0 (AST facts); reasoner entries: the LLM value (max
   * across reasoner-emitted duplicates); cross-source merged ('both'): 1.0.
   */
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

const RISK_RANK = { low: 1, medium: 2, high: 3 } as const;

/** The more severe of two risks; a defined side wins over undefined. */
function moreSevereRisk(
  a: StateCatalogEntry['riskIfUntested'],
  b: StateCatalogEntry['riskIfUntested']
): StateCatalogEntry['riskIfUntested'] {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
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

  const classFileOwners = buildClassFileOwners(codeModel.modules);
  let droppedAmbiguous = 0;

  for (const ds of reasonerOutput.discoveredStates) {
    const filePath = resolveReasonerOwnerFile(ds.className, classFileOwners);
    if (filePath === null) {
      droppedAmbiguous += 1;
      continue;
    }
    const normalizedKey = normalizeStateKey(ds.state);
    const key = entryKey(filePath, ds.className, ds.methodName, normalizedKey);
    const isTested = ds.isTested && resolvedCoverage.isMethodCovered(ds.className, ds.methodName, filePath);
    const existing = byKey.get(key);
    if (existing) {
      if (existing.provenance === 'static') {
        // Same state found by both sources — merge in Task 3.
        existing.provenance = 'both';
        existing.isTested = existing.isTested || isTested;
        existing.confidence = 1;
        existing.riskIfUntested = ds.riskIfUntested;
      } else {
        // Reasoner-reasoner duplicate (e.g. casing variants of one state) —
        // same-source dedupe, not a cross-source merge: keep the provenance,
        // take the max confidence, and keep the more severe risk.
        existing.isTested = existing.isTested || isTested;
        existing.confidence = Math.max(existing.confidence, ds.confidence);
        existing.riskIfUntested = moreSevereRisk(existing.riskIfUntested, ds.riskIfUntested);
      }
    } else {
      byKey.set(key, {
        filePath,
        owner: ds.className,
        methodName: ds.methodName,
        stateName: ds.state,
        normalizedKey,
        provenance: 'reasoner',
        isTested,
        confidence: ds.confidence,
        riskIfUntested: ds.riskIfUntested,
      });
    }
  }

  const entries = [...byKey.values()];
  return {
    entries,
    droppedAmbiguous,
    forMethod(owner, methodName, filePath) {
      return entries.filter((e) => e.owner === owner && e.methodName === methodName && e.filePath === filePath);
    },
  };
}
