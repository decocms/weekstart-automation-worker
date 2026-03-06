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

  if (!scorecard.revenue.chartUrl.startsWith("https://")) {
    failures.push(`revenue.chartUrl: expected https URL (got "${scorecard.revenue.chartUrl.slice(0, 40)}")`);
  }

  // Block 4 — costs
  const { costs } = scorecard;

  if (costs.daysElapsed <= 0 || !Number.isInteger(costs.daysElapsed)) {
    failures.push(`costs.daysElapsed: expected positive integer (got ${costs.daysElapsed})`);
  }

  if (costs.daysInMonth <= 0 || !Number.isInteger(costs.daysInMonth)) {
    failures.push(`costs.daysInMonth: expected positive integer (got ${costs.daysInMonth})`);
  }

  assertFiniteNonNegative(costs.current.totalCost,  "costs.current.totalCost",  failures);
  assertFiniteNonNegative(costs.projectedEOM,        "costs.projectedEOM",       failures);
  assertFiniteNonNegative(costs.previousMonthTotal,  "costs.previousMonthTotal", failures);

  if (!costs.chartUrl.startsWith("https://")) {
    failures.push(`costs.chartUrl: expected https URL (got "${costs.chartUrl.slice(0, 40)}")`);
  }

  if (failures.length > 0) {
    throw new Error(`Scorecard validation failed:\n${failures.map(f => `  • ${f}`).join("\n")}`);
  }
}
