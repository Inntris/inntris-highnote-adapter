import { z } from "zod";

/**
 * A single schema validation failure reduced to shape metadata.
 *
 * Only field paths, issue codes, expected categories and unrecognised key
 * names are carried. Request values never appear, so a summary can be logged
 * from a payload that contains payment data.
 */
export interface SchemaIssueSummary {
  path: string;
  code: string;
  expected?: string;
  keys?: string[];
}

const MAX_ISSUES = 10;
const MAX_KEYS = 10;
const MAX_TOKEN_LENGTH = 64;

function safeToken(value: unknown): string {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "?";
  return text.length > MAX_TOKEN_LENGTH ? `${text.slice(0, MAX_TOKEN_LENGTH)}...` : text;
}

/**
 * Reduces a Zod error to sanitised diagnostics.
 *
 * The Zod issue `message` is deliberately dropped: some issue types embed the
 * received value in it. Anything that cannot be recognised is discarded rather
 * than passed through.
 */
function zodIssues(error: unknown): unknown[] {
  if (typeof error !== "object" || error === null) return [];
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues : [];
}

function toSummary(entry: unknown): SchemaIssueSummary {
  const issue = (typeof entry === "object" && entry !== null ? entry : {}) as {
    code?: unknown;
    path?: unknown;
    expected?: unknown;
    keys?: unknown;
  };
  const path = Array.isArray(issue.path) ? issue.path.map(safeToken).join(".") : "";
  const summary: SchemaIssueSummary = {
    path: path.length === 0 ? "<root>" : path,
    code: typeof issue.code === "string" ? safeToken(issue.code) : "unknown",
  };
  if (typeof issue.expected === "string") summary.expected = safeToken(issue.expected);
  if (Array.isArray(issue.keys)) summary.keys = issue.keys.slice(0, MAX_KEYS).map(safeToken);
  return summary;
}

export function summariseSchemaIssues(error: unknown): SchemaIssueSummary[] {
  const summaries = zodIssues(error).map(toSummary);
  // `unrecognized_keys` names what the sender actually supplied, which is the
  // highest value shape evidence available when a payload is the wrong kind of
  // object entirely. Zod emits it only after every per-field issue, so without
  // this reordering it is the first thing the cap discards.
  const unrecognised = summaries.filter((summary) => summary.code === "unrecognized_keys");
  const rest = summaries.filter((summary) => summary.code !== "unrecognized_keys");
  return [...unrecognised, ...rest].slice(0, MAX_ISSUES);
}

/** Total issue count, so a truncated summary is visibly truncated. */
export function countSchemaIssues(error: unknown): number {
  return zodIssues(error).length;
}

// A deliberately narrow probe. It reads the Highnote request identifier and
// nothing else, so a rejected payload can be correlated with a Highnote Test
// activation attempt without logging any of its contents.
const HighnoteRequestIdProbeSchema = z.object({
  data: z.object({
    collaborativeAuthorizationRequest: z.object({ id: z.string().min(1).max(128) }),
  }),
});

export function highnoteRequestIdFrom(body: unknown): string | undefined {
  const probe = HighnoteRequestIdProbeSchema.safeParse(body);
  return probe.success ? probe.data.data.collaborativeAuthorizationRequest.id : undefined;
}
