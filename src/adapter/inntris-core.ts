import { createHash } from "node:crypto";

import nacl from "tweetnacl";
import { z } from "zod";

import { canonicalise, hashCanonical, sha256Bytes, type Clock } from "../contracts/index.js";
import { AdapterError } from "../errors.js";
import type {
  CollaborativeAuthorizationRequest,
  CollaborativeAuthorizationResponse,
  CollaborativeAuthorizationResponseCode,
} from "../highnote/index.js";
import { corePayloadFromHighnote, type InntrisCoreFinancialPayload } from "./action.js";
import { responseCodeForCoreViolation } from "./composition.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import type { AuthorisationProcessor, CoreProcessedAuthorisation } from "./processor.js";

const UuidSchema = z.uuid();
const ActionHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

const VerifyApprovedResponseSchema = z
  .object({
    verdict: z.literal("approved"),
    verdict_reason: z.string().nullable().optional(),
    approval_token: z.string().min(1),
    trust_score: z.number().int().min(0).max(100),
    audit_id: UuidSchema,
    timestamp: TimestampSchema,
    limits_remaining: z.record(z.string(), z.unknown()).nullable().optional(),
    idempotency_status: z.enum(["new", "replayed"]).nullable().optional(),
  })
  .strict();

const VerifyDeniedResponseSchema = z
  .object({
    verdict: z.enum(["blocked", "rate_limited"]),
    violation_code: z.string().min(1),
    audit_id: UuidSchema,
    timestamp: TimestampSchema,
    detail: z.string().min(1),
    idempotency_status: z.enum(["new", "replayed"]).nullable().optional(),
  })
  .strict();

const VerifyTokenResponseSchema = z
  .object({
    valid: z.boolean(),
    reason: z.string().nullable().optional(),
    verdict: z.string().nullable().optional(),
    agent_id: z.string().nullable().optional(),
    action_hash: ActionHashSchema.nullable().optional(),
    expires_at: TimestampSchema.nullable().optional(),
    action_hash_matches: z.boolean().nullable().optional(),
    consumption_audit_id: UuidSchema.nullable().optional(),
    consumption_status: z.enum(["consumed", "idempotent"]).nullable().optional(),
    execution_ref: z.string().nullable().optional(),
    sandbox: z.boolean().nullable().optional(),
  })
  .strict();

export interface SignedCoreAction {
  agent_id: string;
  action_type: "financial_transaction";
  payload: InntrisCoreFinancialPayload;
  signature: string;
  nonce: string;
  timestamp: string;
  sig_version: 3;
  request_ref: string;
}

export interface BuiltSignedCoreAction {
  request: SignedCoreAction;
  actionHash: string;
}

interface HttpResult {
  status: number;
  body: unknown;
  latencyMs: number;
}

export type InntrisCoreResult =
  | {
      allowed: false;
      verdict: "BLOCK";
      responseCode: CollaborativeAuthorizationResponseCode;
      violationCode: string;
      decisionAuditId: string;
      actionHash: string;
      verifyLatencyMs: number;
      verifyStatus: number;
      verifyIdempotencyStatus?: "new" | "replayed";
    }
  | {
      allowed: true;
      verdict: "ALLOW";
      responseCode: "APPROVED";
      decisionAuditId: string;
      consumptionAuditId: string;
      consumptionStatus: "consumed" | "idempotent";
      actionHash: string;
      verifyLatencyMs: number;
      verifyStatus: number;
      consumeLatencyMs: number;
      consumeStatus: number;
      verifyIdempotencyStatus?: "new" | "replayed";
    };

export type InntrisCoreFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Match Core's Python UTC ISO representation before hashing envelope v3. */
export function canonicalCoreTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AdapterError(
      "INVALID_CORE_TIMESTAMP",
      "Highnote transaction timestamp is invalid",
      422,
    );
  }
  const iso = parsed.toISOString();
  const milliseconds = parsed.getUTCMilliseconds();
  if (milliseconds === 0) return iso.replace(".000Z", "Z");
  return iso.replace(/\.(\d{3})Z$/u, ".$1000Z");
}

export function buildSignedCoreAction(input: {
  agentId: string;
  privateKeyBase64: string;
  payload: InntrisCoreFinancialPayload;
  sourceTimestamp: string;
}): BuiltSignedCoreAction {
  const seed = Buffer.from(input.privateKeyBase64, "base64");
  if (seed.byteLength !== nacl.sign.seedLength) {
    throw new TypeError(`Ed25519 seed must be ${nacl.sign.seedLength} bytes`);
  }
  const requestRef = input.payload.request_ref;
  const nonce = sha256Hex(`inntris-highnote-nonce-v1:${requestRef}`);
  const timestamp = canonicalCoreTimestamp(input.sourceTimestamp);
  const payloadHash = sha256Hex(canonicalise(input.payload));
  const actionHash = sha256Hex(
    canonicalise({
      agent_id: input.agentId,
      action_type: "financial_transaction",
      payload_hash: payloadHash,
      nonce,
      timestamp,
    }),
  );
  try {
    const pair = nacl.sign.keyPair.fromSeed(seed);
    try {
      const signature = Buffer.from(
        nacl.sign.detached(Buffer.from(actionHash, "hex"), pair.secretKey),
      ).toString("base64");
      return {
        actionHash,
        request: {
          agent_id: input.agentId,
          action_type: "financial_transaction",
          payload: input.payload,
          signature,
          nonce,
          timestamp,
          sig_version: 3,
          request_ref: requestRef,
        },
      };
    } finally {
      pair.secretKey.fill(0);
    }
  } finally {
    seed.fill(0);
  }
}

function endpoint(base: URL, pathname: string): URL {
  const normalised = new URL(base);
  normalised.pathname = `${normalised.pathname.replace(/\/$/u, "")}/${pathname}`;
  normalised.search = "";
  normalised.hash = "";
  return normalised;
}

function remainingBudget(deadline: number): number {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) {
    throw new AdapterError("INNTRIS_CORE_TIMEOUT", "Inntris Core deadline was exhausted", 504);
  }
  return remaining;
}

export class InntrisCoreClient {
  readonly #fetch: InntrisCoreFetch;

  constructor(
    readonly options: {
      apiUrl: URL;
      agentId: string;
      privateKeyBase64: string;
      timeoutMs: number;
      fetchImplementation?: InntrisCoreFetch;
    },
  ) {
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #post(pathname: string, body: unknown, timeoutMs: number): Promise<HttpResult> {
    const started = performance.now();
    try {
      const response = await this.#fetch(endpoint(this.options.apiUrl, pathname), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new AdapterError(
          "INNTRIS_CORE_MALFORMED_RESPONSE",
          "Inntris Core returned a non-JSON response",
          502,
        );
      }
      return {
        status: response.status,
        body: responseBody,
        latencyMs: performance.now() - started,
      };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if ((error as { name?: unknown }).name === "TimeoutError") {
        throw new AdapterError("INNTRIS_CORE_TIMEOUT", "Inntris Core request timed out", 504);
      }
      throw new AdapterError("INNTRIS_CORE_UNAVAILABLE", "Inntris Core is unavailable", 502);
    }
  }

  async authorise(input: {
    request: CollaborativeAuthorizationRequest;
    rawBody: Uint8Array;
  }): Promise<InntrisCoreResult> {
    const highnoteRequest = input.request.data.collaborativeAuthorizationRequest;
    const payload = corePayloadFromHighnote({
      request: input.request,
      rawBody: input.rawBody,
      agentId: this.options.agentId,
    });
    const signed = buildSignedCoreAction({
      agentId: this.options.agentId,
      privateKeyBase64: this.options.privateKeyBase64,
      payload,
      sourceTimestamp: highnoteRequest.transactionTimestamp,
    });
    const deadline = performance.now() + this.options.timeoutMs;
    const verification = await this.#post("verify", signed.request, remainingBudget(deadline));
    if (verification.status === 403 || verification.status === 429) {
      const denied = VerifyDeniedResponseSchema.safeParse(verification.body);
      if (!denied.success) {
        throw new AdapterError(
          "INNTRIS_CORE_MALFORMED_RESPONSE",
          "Inntris Core returned a malformed denial",
          502,
        );
      }
      return {
        allowed: false,
        verdict: "BLOCK",
        responseCode: responseCodeForCoreViolation(denied.data.violation_code),
        violationCode: denied.data.violation_code,
        decisionAuditId: denied.data.audit_id,
        actionHash: signed.actionHash,
        verifyLatencyMs: verification.latencyMs,
        verifyStatus: verification.status,
        ...(denied.data.idempotency_status === undefined || denied.data.idempotency_status === null
          ? {}
          : { verifyIdempotencyStatus: denied.data.idempotency_status }),
      };
    }
    if (verification.status !== 200) {
      throw new AdapterError(
        "INNTRIS_CORE_HTTP_ERROR",
        `Inntris Core verification failed with HTTP ${verification.status}`,
        502,
      );
    }
    const approved = VerifyApprovedResponseSchema.safeParse(verification.body);
    if (!approved.success) {
      throw new AdapterError(
        "INNTRIS_CORE_MALFORMED_RESPONSE",
        "Inntris Core returned a malformed approval",
        502,
      );
    }
    const executionRef = payload.request_ref;
    const consumption = await this.#post(
      "verify-token",
      {
        approval_token: approved.data.approval_token,
        agent_id: signed.request.agent_id,
        action_type: signed.request.action_type,
        payload: signed.request.payload,
        nonce: signed.request.nonce,
        timestamp: signed.request.timestamp,
        sig_version: signed.request.sig_version,
        consume: true,
        execution_ref: executionRef,
      },
      remainingBudget(deadline),
    );
    if (consumption.status !== 200) {
      throw new AdapterError(
        "INNTRIS_CORE_CONSUMPTION_HTTP_ERROR",
        `Inntris Core token consumption failed with HTTP ${consumption.status}`,
        502,
      );
    }
    const consumed = VerifyTokenResponseSchema.safeParse(consumption.body);
    if (!consumed.success) {
      throw new AdapterError(
        "INNTRIS_CORE_MALFORMED_RESPONSE",
        "Inntris Core returned a malformed token-consumption response",
        502,
      );
    }
    const data = consumed.data;
    if (
      !data.valid ||
      data.verdict !== "approved" ||
      data.agent_id !== this.options.agentId ||
      data.action_hash !== signed.actionHash ||
      data.action_hash_matches !== true ||
      data.sandbox !== false ||
      data.execution_ref !== executionRef ||
      data.consumption_audit_id === undefined ||
      data.consumption_audit_id === null ||
      data.consumption_status === undefined ||
      data.consumption_status === null
    ) {
      throw new AdapterError(
        "INNTRIS_CORE_CONSUMPTION_REJECTED",
        "Inntris Core did not confirm exact action-bound token consumption",
        502,
      );
    }
    return {
      allowed: true,
      verdict: "ALLOW",
      responseCode: "APPROVED",
      decisionAuditId: approved.data.audit_id,
      consumptionAuditId: data.consumption_audit_id,
      consumptionStatus: data.consumption_status,
      actionHash: signed.actionHash,
      verifyLatencyMs: verification.latencyMs,
      verifyStatus: verification.status,
      consumeLatencyMs: consumption.latencyMs,
      consumeStatus: consumption.status,
      ...(approved.data.idempotency_status === undefined ||
      approved.data.idempotency_status === null
        ? {}
        : { verifyIdempotencyStatus: approved.data.idempotency_status }),
    };
  }
}

function receiptUrl(base: URL, auditId: string): string {
  const normalised = new URL(base);
  normalised.pathname = `${normalised.pathname.replace(/\/$/u, "")}/${encodeURIComponent(auditId)}`;
  normalised.search = "";
  normalised.hash = "";
  return normalised.toString();
}

type CoreProcessedValue = Omit<CoreProcessedAuthorisation, "replayed">;

export class InntrisCoreAuthorisationProcessor implements AuthorisationProcessor {
  readonly #idempotencyStore: InMemoryIdempotencyStore;

  constructor(
    readonly options: {
      client: InntrisCoreClient;
      agentId: string;
      highnoteCardId: string;
      receiptBaseUrl: URL;
      clock: Clock;
      idempotencyStore?: InMemoryIdempotencyStore;
    },
  ) {
    this.#idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  isReady(): boolean {
    return true;
  }

  async process(input: {
    request: CollaborativeAuthorizationRequest;
    rawBody: Uint8Array;
    highnoteSignature: string;
  }): Promise<CoreProcessedAuthorisation> {
    void input.highnoteSignature;
    const highnoteRequest = input.request.data.collaborativeAuthorizationRequest;
    if (highnoteRequest.paymentCard.id !== this.options.highnoteCardId) {
      throw new AdapterError(
        "INNTRIS_CORE_CARD_NOT_BOUND",
        "The Highnote card is not bound to the configured Inntris agent",
        422,
      );
    }
    const result = await this.#idempotencyStore.execute<CoreProcessedValue>(
      highnoteRequest.id,
      hashCanonical(input.request),
      async () => {
        const core = await this.options.client.authorise({
          request: input.request,
          rawBody: input.rawBody,
        });
        const response: CollaborativeAuthorizationResponse = {
          transaction: { id: highnoteRequest.transaction.id },
          responseCode: core.responseCode,
        };
        return {
          authorityMode: "inntris_core",
          response,
          verdict: core.verdict,
          actionHash: core.actionHash,
          decisionAuditId: core.decisionAuditId,
          decisionReceiptUrl: receiptUrl(this.options.receiptBaseUrl, core.decisionAuditId),
          verifyLatencyMs: core.verifyLatencyMs,
          verifyStatus: core.verifyStatus,
          verifyIdempotencyStatus: core.verifyIdempotencyStatus ?? "new",
          downstreamOutcome: "not_configured",
          downstreamLatencyMs: core.verifyLatencyMs + (core.allowed ? core.consumeLatencyMs : 0),
          ...(core.allowed
            ? {
                consumptionAuditId: core.consumptionAuditId,
                consumptionReceiptUrl: receiptUrl(
                  this.options.receiptBaseUrl,
                  core.consumptionAuditId,
                ),
                consumptionStatus: core.consumptionStatus,
                consumeLatencyMs: core.consumeLatencyMs,
                consumeStatus: core.consumeStatus,
              }
            : { violationCode: core.violationCode }),
        };
      },
    );
    return { ...result.value, replayed: result.replayed };
  }
}

export function sourceTimingDiagnostics(
  request: CollaborativeAuthorizationRequest,
  now: Date,
): { highnoteCreatedElapsedMs: number; highnoteTransactionElapsedMs: number } {
  const highnote = request.data.collaborativeAuthorizationRequest;
  return {
    highnoteCreatedElapsedMs: now.getTime() - Date.parse(highnote.createdAt),
    highnoteTransactionElapsedMs: now.getTime() - Date.parse(highnote.transactionTimestamp),
  };
}

export function sourceRequestDigest(rawBody: Uint8Array): string {
  return sha256Bytes(rawBody);
}
