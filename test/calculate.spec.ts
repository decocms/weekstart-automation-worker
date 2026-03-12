import { describe, it, expect } from "vitest";
import { runCalculateStage } from "../src/pipeline/stages/calculate";
import { previousMonth } from "../src/core/date";
import type { CollectRecord, CollectStageOutput } from "../src/core/types";
import type { CostsRawData } from "../src/pipeline/blocks/costs";

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
    nfeStatus: null,
    amount: null,
    statusRaw: null,
    ...overrides,
  };
}

const TZ = "America/Sao_Paulo";
const REF = "2026-03";
const STUB_COSTS_RAW: CostsRawData = {
  summary: {
    days_elapsed: 5,
    days_in_month: 31,
    current_mtd: 1000,
    previous_same_period: 900,
    previous_full_month: 5000,
    same_period_diff_pct: 11.11,
  },
  services: [],
  daily: [],
};

async function runRevenue(records: CollectRecord[], referenceMonth: string = REF) {
  const result = await runCalculateStage(
    makeCollect(records),
    {
      timezone: TZ,
      referenceMonth,
      statsLakeUrl: "https://stats-lake.example/query",
      statsLakeUser: "test",
      statsLakePassword: "test",
    },
    {
      collectCostsDataFn: async () => STUB_COSTS_RAW,
    },
  );

  return result.revenue;
}

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

describe("billedAmount", () => {
  it("sums amount for all records with referenceMonth in reference month", async () => {
    const revenue = await runRevenue([
      rec({ status: "paid", referenceMonth: "2026-03-05", amount: 1000 }),
      rec({ status: "registered", referenceMonth: "2026-03-10", amount: 500 }),
      rec({ status: "paid", referenceMonth: "2026-02-15", amount: 200 }), // excluded: wrong month
    ]);

    expect(revenue.current.billedAmount).toBe(1500);
  });

  it("excludes records with no invoiceCreatedAt", async () => {
    const revenue = await runRevenue([
      rec({ status: "paid", paidDate: "2026-03-01", amount: 999 }),
    ]);

    expect(revenue.current.billedAmount).toBe(0);
    expect(revenue.current.receivedAmount).toBe(999);
  });

  it("respects timezone for ISO datetime: UTC midnight may shift to previous day", async () => {
    const revenue = await runRevenue(
      [rec({ status: "paid", invoiceCreatedAt: "2026-03-01T02:00:00.000Z", amount: 500 })],
      "2026-02",
    );

    expect(revenue.current.billedAmount).toBe(500);
  });
});

describe("receivedAmount", () => {
  it("sums amount for records with paidDate in reference month", async () => {
    const revenue = await runRevenue([
      rec({ status: "paid", paidDate: "2026-03-01", amount: 800 }),
      rec({ status: "paid", paidDate: "2026-03-15", invoiceCreatedAt: "2026-02-01T00:00:00.000Z", amount: 600 }),
      rec({ status: "paid", paidDate: "2026-02-20", amount: 300 }),
    ]);

    expect(revenue.current.receivedAmount).toBe(1400);
  });

  it("includes records paid this month even when invoiceCreatedAt is null", async () => {
    const revenue = await runRevenue([
      rec({ status: "paid", paidDate: "2026-03-10", invoiceCreatedAt: null, amount: 750 }),
    ]);

    expect(revenue.current.receivedAmount).toBe(750);
    expect(revenue.current.billedAmount).toBe(0);
  });
});

describe("expectedInflow", () => {
  it("includes issued invoices that are still unpaid, not canceled, and due within reference month", async () => {
    const revenue = await runRevenue([
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: "2026-03-15", amount: 1000 }),
      rec({ status: "overdue", nfeStatus: "Issued", paidDate: null, dueDate: "2026-03-20", amount: 500 }),
      rec({ status: "registered", nfeStatus: "Draft", paidDate: null, dueDate: "2026-03-10", amount: 200 }), // excluded: not issued
      rec({ status: "paid", nfeStatus: "Issued", paidDate: "2026-03-05", dueDate: "2026-03-05", amount: 300 }), // excluded: already paid
    ]);

    expect(revenue.expectedInflow).toBe(1500);
  });

  it("excludes canceled accounts even when the invoice is issued and unpaid", async () => {
    const revenue = await runRevenue([
      rec({ status: "canceled", statusRaw: "cancelled", nfeStatus: "Issued", paidDate: null, dueDate: "2026-03-15", amount: 500 }),
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: "2026-03-15", amount: 200 }),
    ]);

    expect(revenue.expectedInflow).toBe(200);
  });

  it("excludes invoices with dueDate after reference month end", async () => {
    const revenue = await runRevenue([
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: "2026-04-20", amount: 1000 }), // excluded: due in April
      rec({ status: "overdue", nfeStatus: "Issued", paidDate: null, dueDate: "2026-02-20", amount: 400 }), // included: due before end of March
    ]);

    expect(revenue.expectedInflow).toBe(400);
  });

  it("excludes invoices with no dueDate", async () => {
    const revenue = await runRevenue([
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: null, amount: 1000 }),
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: "2026-03-15", amount: 500 }),
    ]);

    expect(revenue.expectedInflow).toBe(500);
  });
});

describe("totalOpen", () => {
  it("returns all open receivables (issued, unpaid, not canceled) without date filter", async () => {
    const revenue = await runRevenue([
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, amount: 1000 }), // included
      rec({ status: "registered", nfeStatus: "Issued", paidDate: null, dueDate: "2026-05-01", amount: 500 }), // included (future date OK for totalOpen)
      rec({ status: "paid", nfeStatus: "Issued", paidDate: "2026-03-10", amount: 300 }), // excluded: already paid
      rec({ status: "canceled", nfeStatus: "Issued", paidDate: null, amount: 200 }), // excluded: canceled
      rec({ status: "registered", nfeStatus: "Draft", paidDate: null, amount: 100 }), // excluded: not issued
    ]);

    expect(revenue.totalOpen).toBe(1500); // 1000 + 500
  });
});

describe("unknown and canceled exclusions", () => {
  it("excludes unknown and canceled from all revenue metrics", async () => {
    const revenue = await runRevenue([
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
    ]);

    expect(revenue.current.billedAmount).toBe(0);
    expect(revenue.current.receivedAmount).toBe(0);
    expect(revenue.expectedInflow).toBe(0);
    expect(revenue.totalOpen).toBe(0);
  });
});

describe("previous month metrics", () => {
  it("computes previous month metrics independently from current", async () => {
    const revenue = await runRevenue([
      rec({ status: "paid", invoiceCreatedAt: "2026-02-10T12:00:00.000Z", paidDate: "2026-02-20", amount: 700 }),
    ]);

    expect(revenue.previous.billedAmount).toBe(700);
    expect(revenue.previous.receivedAmount).toBe(700);
    expect(revenue.current.billedAmount).toBe(0);
  });
});
