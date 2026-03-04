import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeAirtableRecord, runCollectStage } from "../src/pipeline/stages/collect";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collect stage", () => {
  it("maps status created to registered and picks Name (from Cliente) as client name", () => {
    const normalized = normalizeAirtableRecord({
      id: "recA",
      fields: {
        ID: 1516,
        "Name (from Cliente)": ["Prohall Cosmetic"],
        "Cliente Nome": "Fallback Name",
        "Status Account": "created",
        Valor: 1923.3325,
      },
    });

    expect(normalized.accountId).toBe(1516);
    expect(normalized.clientName).toBe("Prohall Cosmetic");
    expect(normalized.statusRaw).toBe("created");
    expect(normalized.status).toBe("registered");
    expect(normalized.amount).toBe(1923.3325);
  });

  it("collects all pages from Airtable and computes quality counters", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [
              {
                id: "rec01",
                fields: {
                  ID: 1,
                  "Name (from Cliente)": ["Alpha"],
                  "Status Account": "created",
                  "Vencimento original": "",
                  "NF created": "",
                  Valor: 100,
                },
              },
            ],
            offset: "next-page",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [
              {
                id: "rec02",
                fields: {
                  ID: 2,
                  "Name (from Cliente)": ["Beta"],
                  "Status Account": "paid",
                  "Vencimento original": "2025-07-20",
                  "NF created": "2025-07-02T11:47:53.000Z",
                  Valor: 200,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await runCollectStage({
      token: "pat-test",
      baseId: "appBase",
      tableId: "tblMain",
      viewId: "viwMain",
      timezone: "America/Sao_Paulo",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("view")).toBe("viwMain");
    expect(firstUrl.searchParams.get("pageSize")).toBe("100");

    expect(result.source).toBe("airtable");
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.status).toBe("registered");
    expect(result.records[1]?.status).toBe("paid");
    expect(result.quality).toEqual({
      unknownStatusCount: 0,
      missingDueDateForOpenCount: 1,
      missingInvoiceCreatedAtCount: 1,
      missingAmountCount: 0,
    });
  });
});
