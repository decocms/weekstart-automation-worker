import type { CollectRecord, CollectStageOutput, ReceivableStatus } from "../../core/types";

const DEFAULT_AIRTABLE_BASE_ID = "applTenaA2A7ElyNl";
const DEFAULT_AIRTABLE_TABLE_ID = "tblnpSGZ1jqQhJNnm";
const DEFAULT_AIRTABLE_VIEW_ID = "viwC8eUcFU9tp01dw";
const AIRTABLE_PAGE_SIZE = 100;

const REQUIRED_FIELDS = [
  "ID",
  "Name (from Cliente)",
  "Cliente Nome",
  "Cliente",
  "Reference month",
  "Vencimento original",
  "Vencimento",
  "Status Account",
  "Valor",
  "paid_date",
  "Num NF",
  "NF created",
  "NFE.io status",
] as const;

type AirtableFields = Record<string, unknown>;

type AirtableRecord = {
  id: string;
  fields?: AirtableFields;
};

type AirtableListResponse = {
  records?: AirtableRecord[];
  offset?: string;
};

export type CollectStageConfig = {
  token: string;
  baseId?: string;
  tableId?: string;
  viewId?: string;
  timezone: string;
};

function firstValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  for (const item of value) {
    if (item !== null && item !== undefined && String(item).trim() !== "") {
      return item;
    }
  }

  return value[0] ?? null;
}

function asString(value: unknown): string | null {
  const candidate = firstValue(value);
  if (candidate === null || candidate === undefined) return null;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof candidate === "number" || typeof candidate === "boolean") {
    return String(candidate);
  }

  return null;
}

function parseNumberString(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  let normalized = cleaned;

  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function asNumber(value: unknown): number | null {
  const candidate = firstValue(value);
  if (candidate === null || candidate === undefined) return null;

  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate : null;
  }

  if (typeof candidate === "string") {
    return parseNumberString(candidate);
  }

  return null;
}

export function normalizeStatus(rawStatus: string | null): ReceivableStatus {
  if (!rawStatus) return "unknown";

  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return "unknown";

  if (normalized === "created") return "registered";
  if (normalized === "paid") return "paid";
  if (normalized === "registered") return "registered";
  if (normalized === "overdue") return "overdue";
  if (normalized === "canceled" || normalized === "cancelled") return "canceled";

  return "unknown";
}

export function normalizeAirtableRecord(record: AirtableRecord): CollectRecord {
  const fields = record.fields ?? {};
  const statusRaw = asString(fields["Status Account"]);

  return {
    recordId: record.id,
    accountId: asNumber(fields.ID),
    clientName: asString(fields["Name (from Cliente)"]) ?? asString(fields["Cliente Nome"]) ?? asString(fields.Cliente),
    referenceMonth: asString(fields["Reference month"]),
    originalDueDate: asString(fields["Vencimento original"]),
    dueDate: asString(fields["Vencimento"]),
    paidDate: asString(fields.paid_date),
    invoiceNumber: asString(fields["Num NF"]),
    invoiceCreatedAt: asString(fields["NF created"]),
    nfeStatus: asString(fields["NFE.io status"]),
    amount: asNumber(fields.Valor),
    statusRaw,
    status: asString(fields["Status Account"]),
  };
}

function buildAirtableUrl(baseId: string, tableId: string, params: URLSearchParams): string {
  return `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`;
}

async function fetchAllAirtableRecords(config: CollectStageConfig): Promise<AirtableRecord[]> {
  const baseId = config.baseId || DEFAULT_AIRTABLE_BASE_ID;
  const tableId = config.tableId || DEFAULT_AIRTABLE_TABLE_ID;
  const viewId = config.viewId || DEFAULT_AIRTABLE_VIEW_ID;

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    params.set("pageSize", String(AIRTABLE_PAGE_SIZE));
    params.set("view", viewId);
    if (offset) params.set("offset", offset);

    for (const field of REQUIRED_FIELDS) {
      params.append("fields[]", field);
    }

    const response = await fetch(buildAirtableUrl(baseId, tableId, params), {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Airtable collect failed: ${response.status} ${body.slice(0, 240).trim()}`);
    }

    const payload = (await response.json()) as AirtableListResponse;
    if (!Array.isArray(payload.records)) {
      throw new Error("Airtable collect failed: malformed response (records)");
    }

    records.push(...payload.records);
    offset = payload.offset;
  } while (offset);

  return records;
}

export async function runCollectStage(config: CollectStageConfig): Promise<CollectStageOutput> {
  if (!config.token.trim()) {
    throw new Error("Missing Airtable token. Set AIRTABLE_TOKEN (or AIRTABLE_PAT).");
  }

  const rawRecords = await fetchAllAirtableRecords(config);
  const records = rawRecords.map(normalizeAirtableRecord);

  let unknownStatusCount = 0;
  let missingDueDateForOpenCount = 0;
  let missingInvoiceCreatedAtCount = 0;
  let missingAmountCount = 0;

  for (const record of records) {
    if (record.status === "unknown") unknownStatusCount += 1;

    const isOpen = record.status !== "paid" && record.status !== "canceled";
    if (isOpen && !record.dueDate) missingDueDateForOpenCount += 1;

    if (!record.invoiceCreatedAt) missingInvoiceCreatedAtCount += 1;
    if (record.amount === null) missingAmountCount += 1;
  }

  return {
    source: "airtable",
    timezone: config.timezone,
    fetchedAtIso: new Date().toISOString(),
    records,
    quality: {
      unknownStatusCount,
      missingDueDateForOpenCount,
      missingInvoiceCreatedAtCount,
      missingAmountCount,
    },
  };
}
