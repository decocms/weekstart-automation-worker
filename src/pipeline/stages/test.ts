import type { Scorecard } from "./consolidate";

function assertFiniteNonNegative(value: number, label: string, failures: string[]): void {
  if (!Number.isFinite(value) || value < 0) {
    failures.push(`${label}: expected finite non-negative number (got ${value})`);
  }
}

export function runTestStage(scorecard: Scorecard): void {
  const failures: string[] = [];

  if (!/^\d{4}-\d{2}$/.test(scorecard.referenceMonth)) {
    failures.push(`referenceMonth has invalid format: "${scorecard.referenceMonth}"`);
  }

  const { current, previous, totalOpen } = scorecard.revenue;

  for (const [label, m] of [
    ["revenue.current", current],
    ["revenue.previous", previous],
  ] as const) {
    assertFiniteNonNegative(m.billedAmount, `${label}.billedAmount`, failures);
    assertFiniteNonNegative(m.receivedAmount, `${label}.receivedAmount`, failures);
    assertFiniteNonNegative(m.expectedInflow, `${label}.expectedInflow`, failures);
  }

  assertFiniteNonNegative(totalOpen, "revenue.totalOpen", failures);

  if (failures.length > 0) {
    throw new Error(`Scorecard validation failed:\n${failures.map(f => `  • ${f}`).join("\n")}`);
  }
}
