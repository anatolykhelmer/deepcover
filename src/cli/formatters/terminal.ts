import type { ScoreResult, FunctionScore, PrioritizedGap } from '../../scorer/types';

function bar(value: number, max: number = 100, width: number = 10): string {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function methodIndicator(fn: FunctionScore): string {
  if (fn.composite === 0) return '❌';
  if (fn.criticality === 'high' && fn.composite < 50) return '⚠️';
  return '✅';
}

function methodLabel(fn: FunctionScore): string {
  const name = `${fn.className}.${fn.methodName}`;
  const hasDirectTests = fn.strongAssertions > 0 || fn.weakAssertions > 0;

  if (fn.composite === 0 && fn.coverageSource !== 'istanbul') return `${name}  (no tests)`;
  if (fn.composite === 0 && fn.coverageSource === 'istanbul') return `${name}  (Istanbul-only, no direct tests)`;

  const parts: string[] = [];
  if (fn.lineCoveragePercent !== undefined) {
    parts.push(`${Math.round(fn.lineCoveragePercent)}% lines`);
  }
  if (fn.branchCoveragePercent !== undefined && fn.branchCoveragePercent < 100) {
    parts.push(`${Math.round(fn.branchCoveragePercent)}% branches`);
  }
  if (!hasDirectTests && fn.coverageSource === 'istanbul') {
    parts.push('transitive coverage only');
  } else if (fn.criticality === 'high' && fn.composite < 50) {
    parts.push('critical, weak tests');
  } else if (parts.length === 0) {
    parts.push('well-tested');
  }
  return `${name}  (${parts.join(', ')})`;
}

function riskLabel(risk: 'low' | 'medium' | 'high'): string {
  const labels = { low: 'LOW', medium: 'MED', high: 'HIGH' };
  return labels[risk];
}

export function formatTerminalReport(result: ScoreResult): string {
  const lines: string[] = [];

  const hasIstanbul = result.perFunction.some((fn) => fn.coverageSource === 'istanbul');
  lines.push(hasIstanbul ? 'DeepCover Report (with Jest runtime data)' : 'DeepCover Report');
  lines.push('════════════════');
  lines.push(`Composite Score: ${Math.round(result.composite)}/100`);
  lines.push('');

  const subNames = {
    assertionQuality: 'Assertion Quality',
    stateCoverage: 'State Coverage',
    mutationResilience: 'Mutation Resilience',
    criticalityWeighting: 'Criticality Weight',
  } as const;

  for (const [key, label] of Object.entries(subNames)) {
    const sub = result.subScores[key as keyof typeof result.subScores];
    const val = Math.round(sub.final);
    lines.push(`  ${label.padEnd(22)} ${bar(val)}  ${val}`);
  }

  lines.push('');
  lines.push('Per-method breakdown:');

  for (const fn of result.perFunction) {
    const ind = methodIndicator(fn);
    const lbl = methodLabel(fn);
    lines.push(`  ${ind} ${lbl.padEnd(40)} ${Math.round(fn.composite)}`);
  }

  if (result.gaps.length > 0) {
    lines.push('');
    lines.push('Top gaps:');
    const top = result.gaps.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      const g = top[i];
      const rank = i + 1;
      lines.push(`  #${rank} ${riskLabel(g.risk)}  ${g.className}.${g.methodName} — "${g.scenario}"`);
    }
  }

  if (result.potentialBugs && result.potentialBugs.length > 0) {
    lines.push('');
    lines.push(`🔍 Potential Bugs (${result.potentialBugs.length} found)`);
    lines.push('');
    const topBugs = result.potentialBugs.slice(0, 5);
    for (const bug of topBugs) {
      lines.push(`  #${bug.rank}  ${riskLabel(bug.risk).padEnd(4)}  ${bug.className}.${bug.methodName}`);
      lines.push(`      ${bug.pattern} | ${bug.source}`);
      lines.push(`      ${bug.description}`);
      if (bug.suggestedTest) {
        lines.push(`      → ${bug.suggestedTest}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
