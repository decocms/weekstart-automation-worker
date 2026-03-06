import { describe, it, expect } from "vitest";
import { runCalculateStage } from "../src/pipeline/stages/calculate";
import { previousMonth } from "../src/core/date";
import type { CollectRecord, CollectStageOutput } from "../src/core/types";

// ---- helpers ----------------------------------------------------------------

function makeCollect(records: CollectRecord[]): CollectStageOutput {
  return {
    source: "airtable",
    timezone: "America/Sao_Paulo",
    fetchedAtIso: new Date().toISOString(),
    records,
    quality: {
      unknownStatusCount: 0,
      missingDueDateForOpenCount: 0,
      missingInvoiceCreatedAtCount: 0,
      missingAmountCount: 0,
    },
  };
}

function rec(overrides: Partial<CollectRecord> & Pick<CollectRecord, "status">): CollectRecord {
  return {
    recordId: "rec01",
    accountId: null,
    clientName: null,
    referenceMonth: null,
    originalDueDate: null,
    dueDate: null,
    paidDate: null,
    invoiceNumber: null,
    invoiceCreatedAt: null,
    amount: null,
    statusRaw: null,
    ...overrides,
  };
}

const TZ = "America/Sao_Paulo";
const REF = "2026-03";

// ---- previousMonth ----------------------------------------------------------

describe("previousMonth", () => {
  it("decrements month within year", () => {
    expect(previousMonth("2026-03")).toBe("2026-02");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });

  it("wraps January to December of previous year", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2000-01")).toBe("1999-12");
  });
});

// ---- faturado ---------------------------------------------------------------

describe("billedAmount", () => {
  it("sums amount for records with invoiceCreatedAt in reference month", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "paid", invoiceCreatedAt: "2026-03-05T12:00:00.000Z", amount: 1000 }),
        rec({ status: "registered", invoiceCreatedAt: "2026-03-10T00:00:00.000Z", amount: 500 }),
        rec({ status: "paid", invoiceCreatedAt: "2026-02-15T00:00:00.000Z", amount: 200 }), // different month
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.billedAmount).toBe(1500);
  });

  it("excludes records with no invoiceCreatedAt", () => {
    const result = runCalculateStage(
      makeCollect([rec({ status: "paid", paidDate: "2026-03-01", amount: 999 })]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.billedAmount).toBe(0);
    expect(result.revenue.current.receivedAmount).toBe(999);
  });

  it("respects timezone for ISO datetime: UTC midnight may shift to previous day", () => {
    // "2026-03-01T02:00:00.000Z" = "2026-02-28T23:00" in Sao Paulo (UTC-3)
    const result = runCalculateStage(
      makeCollect([rec({ status: "paid", invoiceCreatedAt: "2026-03-01T02:00:00.000Z", amount: 500 })]),
      { timezone: TZ, referenceMonth: "2026-02" },
    );
    expect(result.revenue.current.billedAmount).toBe(500); // belongs to Feb in local TZ
  });
});

// ---- recebido ---------------------------------------------------------------

describe("receivedAmount", () => {
  it("sums amount for records with paidDate in reference month", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "paid", paidDate: "2026-03-01", amount: 800 }),
        rec({ status: "paid", paidDate: "2026-03-15", invoiceCreatedAt: "2026-02-01T00:00:00.000Z", amount: 600 }),
        rec({ status: "paid", paidDate: "2026-02-20", amount: 300 }), // different month
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.receivedAmount).toBe(1400);
  });

  it("includes records paid this month even when invoiceCreatedAt is null", () => {
    const result = runCalculateStage(
      makeCollect([rec({ status: "paid", paidDate: "2026-03-10", invoiceCreatedAt: null, amount: 750 })]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.receivedAmount).toBe(750);
    expect(result.revenue.current.billedAmount).toBe(0);
  });
});

// ---- expectedInflow ---------------------------------------------------------

describe("expectedInflow", () => {
  it("includes registered and overdue due this month, excludes paid and canceled", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "registered", dueDate: "2026-03-15", amount: 1000 }),
        rec({ status: "overdue",    dueDate: "2026-03-20", amount: 500 }),
        rec({ status: "paid",       dueDate: "2026-03-10", amount: 200 }), // paid → excluded
        rec({ status: "canceled",   dueDate: "2026-03-10", amount: 300 }), // canceled → excluded
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.expectedInflow).toBe(1500);
  });

  it("includes registered and overdue from previous months (due <= last day of month)", () => {
    // Filter: dueDate <= "2026-03-31" AND status registered|overdue
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "overdue",    dueDate: "2026-02-15", amount: 300 }),
        rec({ status: "registered", dueDate: "2026-02-10", amount: 400 }), // registered + past due → included
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.expectedInflow).toBe(700);
  });

  it("excludes registered records with due date after end of reference month", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "registered", dueDate: "2026-04-15", amount: 500 }), // April → excluded
        rec({ status: "registered", dueDate: "2026-03-31", amount: 200 }), // last day of March → included
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.expectedInflow).toBe(200);
  });

  it("does not include records with null dueDate", () => {
    const result = runCalculateStage(
      makeCollect([rec({ status: "registered", dueDate: null, amount: 999 })]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.expectedInflow).toBe(0);
  });
});

// ---- totalOpen --------------------------------------------------------------

describe("totalOpen", () => {
  it("sums registered and overdue across all months, regardless of reference month", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "registered", amount: 1000 }),
        rec({ status: "overdue", amount: 500 }),
        rec({ status: "paid", amount: 999 }),     // excluded
        rec({ status: "canceled", amount: 888 }), // excluded
        rec({ status: "unknown", amount: 777 }),  // excluded
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.totalOpen).toBe(1500);
  });
});

// ---- exclusions -------------------------------------------------------------

describe("unknown and canceled exclusions", () => {
  it("excludes unknown and canceled from all revenue metrics", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({
          status: "unknown",
          invoiceCreatedAt: "2026-03-01T12:00:00.000Z",
          paidDate: "2026-03-01",
          dueDate: "2026-03-01",
          amount: 9999,
        }),
        rec({
          status: "canceled",
          invoiceCreatedAt: "2026-03-01T12:00:00.000Z",
          paidDate: "2026-03-01",
          dueDate: "2026-03-01",
          amount: 9999,
        }),
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.current.billedAmount).toBe(0);
    expect(result.revenue.current.receivedAmount).toBe(0);
    expect(result.revenue.current.expectedInflow).toBe(0);
    expect(result.revenue.totalOpen).toBe(0);
  });
});

// ---- previous month ---------------------------------------------------------

describe("previous month metrics", () => {
  it("computes previous month metrics independently from current", () => {
    const result = runCalculateStage(
      makeCollect([
        rec({ status: "paid", invoiceCreatedAt: "2026-02-10T12:00:00.000Z", paidDate: "2026-02-20", amount: 700 }),
      ]),
      { timezone: TZ, referenceMonth: REF },
    );
    expect(result.revenue.previous.billedAmount).toBe(700);
    expect(result.revenue.previous.receivedAmount).toBe(700);
    expect(result.revenue.current.billedAmount).toBe(0);
  });
});
