import { describe, it, expect } from "vitest";
import { buildInvoicingVsCashInChartConfig, computeHistoricalRevenue } from "../src/pipeline/blocks/revenue";
import type { CollectRecord } from "../src/core/types";

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

describe("revenue historical series", () => {
  it("uses Reference month as invoiced bucket for historical chart", () => {
    const history = computeHistoricalRevenue(
      [
        rec({
          status: "paid",
          amount: 100,
          referenceMonth: "2025-11-30",
          invoiceCreatedAt: "2025-12-02T10:00:00.000Z",
          paidDate: "2025-12-10",
        }),
      ],
      "2025-12",
      "America/Sao_Paulo",
      2,
    );

    expect(history).toHaveLength(2);
    expect(history[0]?.month).toBe("2025-11");
    expect(history[0]?.billedAmount).toBe(100);
    expect(history[1]?.month).toBe("2025-12");
    expect(history[1]?.billedAmount).toBe(0);
  });

  it("falls back to invoiceCreatedAt month when Reference month is missing", () => {
    const history = computeHistoricalRevenue(
      [
        rec({
          status: "paid",
          amount: 200,
          referenceMonth: null,
          invoiceCreatedAt: "2025-12-05T10:00:00.000Z",
          paidDate: "2025-12-15",
        }),
      ],
      "2025-12",
      "America/Sao_Paulo",
      2,
    );

    expect(history[0]?.month).toBe("2025-11");
    expect(history[0]?.billedAmount).toBe(0);
    expect(history[1]?.month).toBe("2025-12");
    expect(history[1]?.billedAmount).toBe(200);
  });
});

describe("invoicing vs cash in chart config", () => {
  it("includes BRL unit in series labels and y-axis", () => {
    const config = buildInvoicingVsCashInChartConfig([
      { month: "2025-11", billedAmount: 100, receivedAmount: 80, arBalance: 50, arDelta: 10 },
      { month: "2025-12", billedAmount: 200, receivedAmount: 190, arBalance: 60, arDelta: 10 },
    ]) as {
      data: { datasets: Array<{ label: string }> };
      options: {
        plugins?: { tickFormat?: { prefix?: string } };
        scales?: { yAxes?: Array<{ scaleLabel?: { labelString?: string } }> };
      };
    };

    expect(config.data.datasets[0]?.label).toBe("Invoiced (R$)");
    expect(config.data.datasets[1]?.label).toBe("Cash In (R$)");
    expect(config.data.datasets[2]?.label).toBe("Gap (R$)");
    expect(config.options.plugins?.tickFormat?.prefix).toBe("R$ ");
    expect(config.options.scales?.yAxes?.[0]?.scaleLabel?.labelString).toBe("Valor (R$)");
  });
});
