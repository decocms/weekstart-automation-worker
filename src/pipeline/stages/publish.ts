/**
 * Publish stage — creates a Linear Document in the configured project.
 *
 * The document uses the "Week end" template structure. Financial scorecard
 * data is injected inside the "Announcements & distinctions" section,
 * after the existing introductory blockquote.
 *
 * Linear API notes:
 *   - Endpoint: https://api.linear.app/graphql
 *   - Auth: raw API key in Authorization header (no "Bearer" prefix)
 *   - DocumentCreateInput.content is plain markdown
 */

import type { Scorecard } from "./consolidate";
import { previousMonth } from "../../core/date";

// ---- Types ------------------------------------------------------------------

export type PublishStageConfig = {
  linearApiKey: string;
  linearProjectId: string;
  timezone: string;
};

export type PublishStageResult = {
  documentId: string;
  documentUrl: string;
};

// ---- Constants --------------------------------------------------------------

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const WEEK_END_TEMPLATE_ID = "9a8b2bd1-5e99-4810-a89a-c4032d4c0579";
const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// ---- Markdown helpers -------------------------------------------------------

function fmtBRL(amount: number): string {
  const fixed = Math.abs(amount).toFixed(2);
  const [int, dec] = fixed.split(".");
  const intFmt = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFmt},${dec}`;
}

function yearMonthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_PT[month - 1]}/${ym.slice(0, 4)}`;
}

/** Formats an ISO datetime as "DD/MM/YYYY" in the given IANA timezone. */
function formatRunDate(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get("day")}/${get("month")}/${get("year")}`;
}

// ---- Document content builder -----------------------------------------------

/**
 * Builds the full document markdown by injecting the scorecard table
 * into the "Announcements & distinctions" section of the Week end template.
 */
function buildDocumentContent(
  scorecard: Scorecard,
  revenueChartAssetUrl: string,
): string {
  const { revenue, costs } = scorecard;
  const { current, previous, referenceMonth, totalOpen } = revenue;

  const currLabel = yearMonthLabel(referenceMonth);
  const prevLabel = yearMonthLabel(previousMonth(referenceMonth));

  const fmtDelta = (prev: number, curr: number): string => {
    if (prev === 0) return curr > 0 ? "new" : "—";
    const pct = ((curr - prev) / prev) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };

  const cmp = (prev: number, curr: number) =>
    `vs. ${prevLabel}: ${fmtBRL(prev)} (${fmtDelta(prev, curr)})`;

  const costsSamePeriodNote =
    costs.samePeriodDiffPct !== null
      ? ` · vs. mesmo periodo ${prevLabel}: ${fmtBRL(costs.previous.totalCost)} (${costs.samePeriodDiffPct >= 0 ? "+" : ""}${costs.samePeriodDiffPct.toFixed(1)}%)`
      : ` · sem dados do mesmo periodo em ${prevLabel}`;

  const scorecardSection = [
    `## Finance - ${currLabel}`,
    "",
    `> **Invoiced** — Invoices issued this month`,
    `> **${fmtBRL(current.billedAmount)}** · ${cmp(previous.billedAmount, current.billedAmount)}`,
    "",
    `> **Cash In** — Payments confirmed this month`,
    `> **${fmtBRL(current.receivedAmount)}** · ${cmp(previous.receivedAmount, current.receivedAmount)}`,
    "",
    `![Cash In acumulado](${revenueChartAssetUrl})`,
    "",
    `> **Expected Inflow** — Unpaid receivables due by end of ${currLabel}`,
    `> **${fmtBRL(current.expectedInflow)}**`,
    "",
    `> **A/R Total** — All open receivables across all months`,
    `> **${fmtBRL(totalOpen)}**`,
    "",
    `## Infra GCP - ${currLabel}`,
    "",
    `> **MTD** — Custo acumulado (primeiros ${costs.daysElapsed} dias)`,
    `> **${fmtBRL(costs.current.totalCost)}**${costsSamePeriodNote}`,
    "",
    `> **Projecao EOM** — Estimativa para fim de ${currLabel}`,
    `> **${fmtBRL(costs.projectedEOM)}** · mes anterior total: ${fmtBRL(costs.previousMonthTotal)}`,
  ].join("\n");

  return [
    "# Announcements & distinctions",
    "",
    "> *10 minutes* — What is relevant for **everyone** in the company to know? What breakthrough would you like to share that can help others in the company?",
    "",
    "# Ask for help",
    "",
    "> *10 minutes* — Drowning in backlog? Talk about it. Think you found a time-bomb? Share with the team. We thrive on challenges! Suffering in silence, however, is forbidden.",
    "",
    "# Milestones and our weekly outcomes",
    "",
    "> *30 minutes* — Time to share what went right (our highlights/results), what went wrong (our learnings) and let's showcase our improvements towards our commitments (**DEMO TIME!**)",
    "",
    scorecardSection,
    "",
    "# Recognition and thanks",
    "",
    "> *10 minutes* — Recognize or thank your peers for something you admired.",
  ].join("\n");
}

// ---- Chart upload -----------------------------------------------------------

type FileUploadPayload = {
  data?: {
    fileUpload?: {
      success: boolean;
      uploadFile?: {
        uploadUrl: string;
        assetUrl: string;
        headers: Array<{ key: string; value: string }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
};

const FILE_UPLOAD_MUTATION = `
  mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
    fileUpload(contentType: $contentType, filename: $filename, size: $size) {
      success
      uploadFile {
        uploadUrl
        assetUrl
        headers { key value }
      }
    }
  }
`;

/**
 * Fetches the chart PNG from QuickChart (server-to-server) and uploads it to
 * Linear's private storage via the fileUpload mutation. Returns the assetUrl
 * on uploads.linear.app, which Linear can render without CSP restrictions.
 */
async function uploadChartToLinear(
  chartUrl: string,
  linearApiKey: string,
  filename: string,
): Promise<string> {
  // 1. Fetch the chart PNG from QuickChart
  const imageResponse = await fetch(chartUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch chart image: HTTP ${imageResponse.status}`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const size = imageBuffer.byteLength;

  // 2. Request a pre-signed upload URL from Linear
  const mutationResponse = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey,
    },
    body: JSON.stringify({
      query: FILE_UPLOAD_MUTATION,
      variables: { contentType: "image/png", filename, size },
    }),
  });

  if (!mutationResponse.ok) {
    const body = await mutationResponse.text().catch(() => "");
    throw new Error(
      `fileUpload mutation failed: HTTP ${mutationResponse.status} ${body.slice(0, 240).trim()}`,
    );
  }

  const uploadPayload = (await mutationResponse.json()) as FileUploadPayload;
  if (uploadPayload.errors?.length) {
    const msg = uploadPayload.errors.map(e => e.message).join("; ");
    throw new Error(`fileUpload mutation failed: ${msg}`);
  }

  const uploadFile = uploadPayload.data?.fileUpload?.uploadFile;
  if (!uploadFile?.uploadUrl || !uploadFile.assetUrl) {
    throw new Error("fileUpload returned no uploadUrl or assetUrl");
  }

  // 3. PUT the binary to the signed URL with Linear's required headers
  const extraHeaders = Object.fromEntries(
    uploadFile.headers.map(h => [h.key, h.value]),
  );
  const putResponse = await fetch(uploadFile.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/png",
      "cache-control": "max-age=31536000",
      ...extraHeaders,
    },
    body: imageBuffer,
  });

  if (!putResponse.ok) {
    const body = await putResponse.text().catch(() => "");
    throw new Error(
      `Chart upload PUT failed: HTTP ${putResponse.status} ${body.slice(0, 240).trim()}`,
    );
  }

  return uploadFile.assetUrl;
}

// ---- Linear API -------------------------------------------------------------

type LinearDocumentPayload = {
  data?: {
    documentCreate?: {
      success: boolean;
      document?: {
        id: string;
        url: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
};

const DOCUMENT_CREATE_MUTATION = `
  mutation DocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document { id url }
    }
  }
`;

// ---- Stage ------------------------------------------------------------------

/** Creates a Linear Document for the current scorecard run. */
export async function runPublishStage(
  scorecard: Scorecard,
  config: PublishStageConfig,
): Promise<PublishStageResult> {
  // Upload revenue chart to Linear's storage (server-to-server) so it renders
  // without CSP restrictions. GCP costs chart temporarily disabled.
  const revenueChartAssetUrl = await uploadChartToLinear(
    scorecard.revenue.chartUrl,
    config.linearApiKey,
    "revenue-cashin.png",
  );

  const input = {
    title: `Week-end | ${formatRunDate(scorecard.generatedAtIso, config.timezone)}`,
    content: buildDocumentContent(scorecard, revenueChartAssetUrl),
    projectId: config.linearProjectId,
    lastAppliedTemplateId: WEEK_END_TEMPLATE_ID,
    icon: "Dino",
    color: "#4cb782",
  };

  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.linearApiKey,
    },
    body: JSON.stringify({
      query: DOCUMENT_CREATE_MUTATION,
      variables: { input },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Linear publish failed: HTTP ${response.status} ${body.slice(0, 240).trim()}`);
  }

  const payload = (await response.json()) as LinearDocumentPayload;

  if (payload.errors?.length) {
    const msg = payload.errors.map(e => e.message).join("; ");
    throw new Error(`Linear publish failed: ${msg}`);
  }

  const result = payload.data?.documentCreate;
  if (!result?.success || !result.document) {
    throw new Error("Linear publish failed: documentCreate returned success=false or no document");
  }

  return {
    documentId: result.document.id,
    documentUrl: result.document.url,
  };
}
