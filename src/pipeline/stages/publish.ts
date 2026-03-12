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
import { renderScorecardSvg } from "../../scorecard";

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

type ChartAssets = {
  scorecardCard?: string;
};

/**
 * Builds the full document markdown by injecting the scorecard
 * into the "We are profitable" section of the Week end template.
 */
function buildDocumentContent(scorecard: Scorecard, chartAssets: ChartAssets): string {
  const currLabel = yearMonthLabel(scorecard.referenceMonth);

  // Scorecard card image only (visual summary)
  const scorecardSection = chartAssets.scorecardCard
    ? `### Finance - ${currLabel}\n\n![Finance Scorecard](${chartAssets.scorecardCard})`
    : `### Finance - ${currLabel}`;

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
    "## We are profitable and have lean ops",
    "",
    scorecardSection,
    "",
    "## Validated PMF for ecommerce agents",
    "",
    "## Decocms is the obvious choice for VTEX enterprise storefronts",
    "",
    "## Studio works as home for storefront, cogna and studio (builder) projects",
    "",
    "# Recognition and thanks",
    "",
    "> *10 minutes* — Recognize or thank your peers for something you admired.",
  ].join("\n");
}

// ---- Scorecard card SVG -----------------------------------------------------

/**
 * Generates a scorecard card SVG and uploads it to Linear.
 *
 * @param scorecard - The scorecard data
 * @param linearApiKey - Linear API key for upload
 * @returns The Linear asset URL for the card image
 */
async function generateAndUploadCardSvg(
  scorecard: Scorecard,
  linearApiKey: string,
): Promise<string> {
  // Generate SVG
  const svg = renderScorecardSvg(scorecard, { width: 840 });
  const svgBuffer = new TextEncoder().encode(svg);
  const size = svgBuffer.byteLength;

  // Request upload URL from Linear
  const mutationResponse = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey,
    },
    body: JSON.stringify({
      query: FILE_UPLOAD_MUTATION,
      variables: { contentType: "image/svg+xml", filename: "scorecard-card.svg", size },
    }),
  });

  if (!mutationResponse.ok) {
    const body = await mutationResponse.text().catch(() => "");
    throw new Error(`fileUpload mutation failed: HTTP ${mutationResponse.status} ${body.slice(0, 240).trim()}`);
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

  // PUT the SVG to the signed URL
  const extraHeaders = Object.fromEntries(
    uploadFile.headers.map(h => [h.key, h.value]),
  );
  const putResponse = await fetch(uploadFile.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/svg+xml",
      "cache-control": "max-age=31536000",
      ...extraHeaders,
    },
    body: svgBuffer,
  });

  if (!putResponse.ok) {
    const body = await putResponse.text().catch(() => "");
    throw new Error(`Card SVG upload PUT failed: HTTP ${putResponse.status} ${body.slice(0, 240).trim()}`);
  }

  return uploadFile.assetUrl;
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
  // Generate and upload scorecard card SVG
  const scorecardCardAssetUrl = await generateAndUploadCardSvg(
    scorecard,
    config.linearApiKey,
  );

  const chartAssets: ChartAssets = {
    scorecardCard: scorecardCardAssetUrl,
  };

  const input = {
    title: `Week-end | ${formatRunDate(scorecard.generatedAtIso, config.timezone)}`,
    content: buildDocumentContent(scorecard, chartAssets),
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


