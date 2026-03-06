/**
 * Core domain types for the collect stage.
 *
 * These are the fundamental input types consumed by every pipeline block.
 * Block-specific output types (RevenueBlock, etc.) live alongside their
 * block in src/pipeline/blocks/.
 */

export type ReceivableStatus = "paid" | "registered" | "overdue" | "canceled" | "unknown";

/**
 * A single normalized accounts receivable record as produced by the collect
 * stage. All fields that may be absent in the source data are nullable.
 */
export type CollectRecord = {
  recordId: string;
  accountId: number | null;
  clientName: string | null;
  referenceMonth: string | null;
  originalDueDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  invoiceNumber: string | null;
  invoiceCreatedAt: string | null;
  amount: number | null;
  statusRaw: string | null;
  status: ReceivableStatus;
};

/**
 * Data quality counters emitted alongside records so consumers can assess
 * collection completeness without re-scanning the full dataset.
 */
export type CollectQualityReport = {
  unknownStatusCount: number;
  missingDueDateForOpenCount: number;
  missingInvoiceCreatedAtCount: number;
  missingAmountCount: number;
};

/** Canonical output of the collect stage. */
export type CollectStageOutput = {
  source: "airtable";
  timezone: string;
  fetchedAtIso: string;
  records: CollectRecord[];
  quality: CollectQualityReport;
};
