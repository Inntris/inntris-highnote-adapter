import { createHash } from "node:crypto";

import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";

import {
  buildSignedCoreAction,
  corePayloadFromHighnote,
  InntrisCoreAuthorisationProcessor,
  InntrisCoreClient,
  type InntrisCoreFetch,
} from "../src/adapter/index.js";
import { buildApp } from "../src/app.js";
import { canonicalise } from "../src/contracts/index.js";
import { AdapterError } from "../src/errors.js";
import { CollectingEvidenceSink } from "../src/evidence/index.js";
import { AdapterMetrics } from "../src/metrics.js";
import { clock, HIGHNOTE_SECRET, highnoteRequest, signedBody } from "./helpers.js";

const AGENT_ID = "2836f6c7-ba2b-4b36-801d-0f1a0f84982e";
const DECISION_AUDIT_ID = "4db47416-02b2-4a52-947d-663aeeb0712d";
const CONSUMPTION_AUDIT_ID = "a5f7ea59-7d1f-40bc-98b3-a8330448b68c";
const TEST_SEED = Buffer.alloc(32, 7);

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function actionHashFromRequest(body: Record<string, unknown>): string {
  const payloadHash = createHash("sha256").update(canonicalise(body["payload"])).digest("hex");
  return createHash("sha256")
    .update(
      canonicalise({
        agent_id: body["agent_id"],
        action_type: body["action_type"],
        payload_hash: payloadHash,
        nonce: body["nonce"],
        timestamp: body["timestamp"],
      }),
    )
    .digest("hex");
}

function successfulCoreFetch(
  consumptionStatus: "consumed" | "idempotent" = "consumed",
): ReturnType<typeof vi.fn<InntrisCoreFetch>> {
  let expectedActionHash = "";
  return vi.fn<InntrisCoreFetch>((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (typeof init?.body !== "string") throw new TypeError("Expected a JSON request body");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (url.endsWith("/verify")) {
      expectedActionHash = actionHashFromRequest(body);
      return Promise.resolve(
        response(200, {
          verdict: "approved",
          verdict_reason: "All verification checks passed",
          approval_token: "test-approval-token",
          trust_score: 50,
          audit_id: DECISION_AUDIT_ID,
          timestamp: "2026-08-12T12:00:00Z",
          limits_remaining: {},
          idempotency_status: "new",
        }),
      );
    }
    return Promise.resolve(
      response(200, {
        valid: true,
        reason: null,
        verdict: "approved",
        agent_id: AGENT_ID,
        action_hash: expectedActionHash,
        expires_at: "2026-08-12T12:05:00Z",
        action_hash_matches: true,
        consumption_audit_id: CONSUMPTION_AUDIT_ID,
        consumption_status: consumptionStatus,
        execution_ref: body["execution_ref"],
        sandbox: false,
      }),
    );
  });
}

function client(fetchImplementation: InntrisCoreFetch): InntrisCoreClient {
  return new InntrisCoreClient({
    apiUrl: new URL("https://api.inntris.example/"),
    agentId: AGENT_ID,
    privateKeyBase64: TEST_SEED.toString("base64"),
    timeoutMs: 1_200,
    fetchImplementation,
  });
}

function processor(
  fetchImplementation: InntrisCoreFetch,
  highnoteCardId = "card_allow_001",
): InntrisCoreAuthorisationProcessor {
  return new InntrisCoreAuthorisationProcessor({
    client: client(fetchImplementation),
    agentId: AGENT_ID,
    highnoteCardId,
    receiptBaseUrl: new URL("https://www.inntris.com/verify/"),
    clock,
  });
}

describe("Inntris Core signing and action mapping", () => {
  it("builds the exact RFC 8785 envelope v3 and a standard-base64 Ed25519 signature", () => {
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const payload = corePayloadFromHighnote({ request, rawBody, agentId: AGENT_ID });
    const signed = buildSignedCoreAction({
      agentId: AGENT_ID,
      privateKeyBase64: TEST_SEED.toString("base64"),
      payload,
      sourceTimestamp: request.data.collaborativeAuthorizationRequest.transactionTimestamp,
    });

    expect(signed.request.sig_version).toBe(3);
    expect(signed.request.request_ref).toBe("highnote:te_allow_001");
    expect(signed.request.payload.request_ref).toBe(signed.request.request_ref);
    expect(signed.request.timestamp).toBe("2026-08-12T11:59:59.900000Z");
    expect(signed.request.nonce).toMatch(/^[a-f0-9]{64}$/u);
    expect(signed.request.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(JSON.stringify(signed.request.payload)).not.toContain("card_allow_001");
    expect(signed.actionHash).toBe(
      "0c77c2cbdfea7c819190016b53279a3e93ebc87a646026a91e557256b2a0802f",
    );

    const publicKey = nacl.sign.keyPair.fromSeed(TEST_SEED).publicKey;
    expect(
      nacl.sign.detached.verify(
        Buffer.from(signed.actionHash, "hex"),
        Buffer.from(signed.request.signature, "base64"),
        publicKey,
      ),
    ).toBe(true);
  });

  it("rejects non-USD authorisations instead of applying USD limits", () => {
    const request = highnoteRequest({ currency: "EUR" });
    const { rawBody } = signedBody(request);
    try {
      corePayloadFromHighnote({ request, rawBody, agentId: AGENT_ID });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ code: "UNSUPPORTED_CURRENCY" });
      return;
    }
    throw new Error("Expected a non-USD authorisation to be rejected");
  });
});

describe("Inntris Core inline authority flow", () => {
  it("consumes the exact approved action before returning APPROVED", async () => {
    const fetchImplementation = successfulCoreFetch();
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const result = await client(fetchImplementation).authorise({ request, rawBody });

    expect(result).toMatchObject({
      allowed: true,
      responseCode: "APPROVED",
      decisionAuditId: DECISION_AUDIT_ID,
      consumptionAuditId: CONSUMPTION_AUDIT_ID,
      consumptionStatus: "consumed",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const verifyRequestBody = fetchImplementation.mock.calls[0]?.[1]?.body;
    const consumeRequestBody = fetchImplementation.mock.calls[1]?.[1]?.body;
    if (typeof verifyRequestBody !== "string" || typeof consumeRequestBody !== "string") {
      throw new TypeError("Expected JSON request bodies");
    }
    const verifyBody = JSON.parse(verifyRequestBody) as Record<string, unknown>;
    const consumeBody = JSON.parse(consumeRequestBody) as Record<string, unknown>;
    expect(consumeBody).toMatchObject({
      action_type: verifyBody["action_type"],
      payload: verifyBody["payload"],
      nonce: verifyBody["nonce"],
      timestamp: verifyBody["timestamp"],
      sig_version: 3,
      consume: true,
      execution_ref: "highnote:te_allow_001",
    });
  });

  it("treats same-execution idempotent consumption as APPROVED", async () => {
    const fetchImplementation = successfulCoreFetch("idempotent");
    const request = highnoteRequest({ requestId: "te_retry_001" });
    const { rawBody } = signedBody(request);
    const result = await client(fetchImplementation).authorise({ request, rawBody });
    expect(result).toMatchObject({ allowed: true, consumptionStatus: "idempotent" });
  });

  it("maps a Core spend block and never calls token consumption", async () => {
    const fetchImplementation = vi.fn<InntrisCoreFetch>(() =>
      Promise.resolve(
        response(403, {
          verdict: "blocked",
          violation_code: "per_action_limit_exceeded",
          audit_id: DECISION_AUDIT_ID,
          timestamp: "2026-08-12T12:00:00Z",
          detail: "Amount exceeds per-action limit",
          idempotency_status: "new",
        }),
      ),
    );
    const request = highnoteRequest({ amount: 25_000 });
    const { rawBody } = signedBody(request);
    const result = await client(fetchImplementation).authorise({ request, rawBody });
    expect(result).toMatchObject({
      allowed: false,
      responseCode: "EXCEEDS_LIMIT",
      decisionAuditId: DECISION_AUDIT_ID,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("fails closed when consumption does not bind the approved action", async () => {
    const fetchImplementation = successfulCoreFetch();
    const approveImplementation = fetchImplementation.getMockImplementation();
    if (approveImplementation === undefined) throw new TypeError("Missing Core mock");
    fetchImplementation.mockImplementationOnce(approveImplementation);
    fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(
        response(200, {
          valid: false,
          reason: "action hash mismatch",
          verdict: "approved",
          agent_id: AGENT_ID,
          action_hash: "0".repeat(64),
          expires_at: "2026-08-12T12:05:00Z",
          action_hash_matches: false,
          consumption_audit_id: null,
          consumption_status: null,
          execution_ref: "highnote:te_allow_001",
          sandbox: false,
        }),
      ),
    );
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    await expect(client(fetchImplementation).authorise({ request, rawBody })).rejects.toMatchObject(
      {
        code: "INNTRIS_CORE_CONSUMPTION_REJECTED",
      },
    );
  });

  it("fails closed on malformed or unavailable Core responses", async () => {
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const malformed = vi.fn<InntrisCoreFetch>(() =>
      Promise.resolve(response(200, { verdict: "approved" })),
    );
    await expect(client(malformed).authorise({ request, rawBody })).rejects.toMatchObject({
      code: "INNTRIS_CORE_MALFORMED_RESPONSE",
    });

    const unavailable = vi.fn<InntrisCoreFetch>(() =>
      Promise.reject(new TypeError("network down")),
    );
    await expect(client(unavailable).authorise({ request, rawBody })).rejects.toMatchObject({
      code: "INNTRIS_CORE_UNAVAILABLE",
    });
  });
});

describe("Inntris Core processor boundaries", () => {
  it("declines an unbound card before any Core request", async () => {
    const fetchImplementation = successfulCoreFetch();
    const coreProcessor = processor(fetchImplementation, "different-card");
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    await expect(
      coreProcessor.process({ request, rawBody, highnoteSignature: "authenticated-upstream" }),
    ).rejects.toMatchObject({ code: "INNTRIS_CORE_CARD_NOT_BOUND" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not create a second Core reservation for a duplicate Highnote request id", async () => {
    const fetchImplementation = successfulCoreFetch();
    const coreProcessor = processor(fetchImplementation);
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const first = await coreProcessor.process({
      request,
      rawBody,
      highnoteSignature: "authenticated-upstream",
    });
    const second = await coreProcessor.process({
      request,
      rawBody,
      highnoteSignature: "authenticated-upstream",
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(first.decisionAuditId).toBe(second.decisionAuditId);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("honours a live Core limit change without changing adapter configuration", async () => {
    let limitUsd = 100;
    let expectedActionHash = "";
    const fetchImplementation = vi.fn<InntrisCoreFetch>((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (typeof init?.body !== "string") throw new TypeError("Expected a JSON request body");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (url.endsWith("/verify")) {
        expectedActionHash = actionHashFromRequest(body);
        const payload = body["payload"] as Record<string, unknown>;
        if (Number(payload["amount"]) > limitUsd) {
          return Promise.resolve(
            response(403, {
              verdict: "blocked",
              violation_code: "per_action_limit_exceeded",
              audit_id: DECISION_AUDIT_ID,
              timestamp: "2026-08-12T12:00:00Z",
              detail: "Amount exceeds per-action limit",
              idempotency_status: "new",
            }),
          );
        }
        return Promise.resolve(
          response(200, {
            verdict: "approved",
            approval_token: "test-approval-token",
            trust_score: 50,
            audit_id: DECISION_AUDIT_ID,
            timestamp: "2026-08-12T12:00:00Z",
            limits_remaining: {},
            idempotency_status: "new",
          }),
        );
      }
      return Promise.resolve(
        response(200, {
          valid: true,
          verdict: "approved",
          agent_id: AGENT_ID,
          action_hash: expectedActionHash,
          action_hash_matches: true,
          consumption_audit_id: CONSUMPTION_AUDIT_ID,
          consumption_status: "consumed",
          execution_ref: body["execution_ref"],
          sandbox: false,
        }),
      );
    });
    const coreProcessor = processor(fetchImplementation);
    const firstRequest = highnoteRequest({
      requestId: "te_limit_100",
      transactionId: "tx_limit_100",
      amount: 5_000,
    });
    const firstBody = signedBody(firstRequest).rawBody;
    expect(
      (
        await coreProcessor.process({
          request: firstRequest,
          rawBody: firstBody,
          highnoteSignature: "authenticated-upstream",
        })
      ).response.responseCode,
    ).toBe("APPROVED");

    limitUsd = 25;
    const secondRequest = highnoteRequest({
      requestId: "te_limit_25",
      transactionId: "tx_limit_25",
      amount: 5_000,
    });
    const secondBody = signedBody(secondRequest).rawBody;
    expect(
      (
        await coreProcessor.process({
          request: secondRequest,
          rawBody: secondBody,
          highnoteSignature: "authenticated-upstream",
        })
      ).response.responseCode,
    ).toBe("EXCEEDS_LIMIT");
  });

  it("never treats a Core client error as a local policy decision", async () => {
    const fetchImplementation = vi.fn<InntrisCoreFetch>(() =>
      Promise.reject(new AdapterError("INNTRIS_CORE_TIMEOUT", "Core timeout", 504)),
    );
    const coreProcessor = processor(fetchImplementation);
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    await expect(
      coreProcessor.process({ request, rawBody, highnoteSignature: "authenticated-upstream" }),
    ).rejects.toMatchObject({ code: "INNTRIS_CORE_TIMEOUT" });
  });

  it("emits no adapter-local authority evidence in Core mode", async () => {
    const sink = new CollectingEvidenceSink();
    const metrics = new AdapterMetrics(false);
    const app = buildApp({
      processor: processor(successfulCoreFetch()),
      evidenceSink: sink,
      clock,
      signingSecrets: [HIGHNOTE_SECRET],
      signatureEncoding: "hex",
      maxSignatureAgeMs: 300_000,
      maxFutureSkewMs: 30_000,
      authorizationFailurePolicy: "decline",
      metrics,
      logger: false,
    });
    const request = highnoteRequest();
    const { rawBody, signature } = signedBody(request);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/highnote/collaborative-authorization",
        headers: { "content-type": "application/json", "highnote-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ responseCode: "APPROVED" });
      expect(sink.bundles).toHaveLength(0);
      const scraped = await metrics.registry.metrics();
      expect(scraped).toContain(
        'inntris_core_authority_total{verdict="ALLOW",consumption="consumed"} 1',
      );
    } finally {
      await app.close();
    }
  });

  it("returns an explicit decline when Core fails after Highnote authentication", async () => {
    const sink = new CollectingEvidenceSink();
    const fetchImplementation = vi.fn<InntrisCoreFetch>(() =>
      Promise.reject(new TypeError("network unavailable")),
    );
    const app = buildApp({
      processor: processor(fetchImplementation),
      evidenceSink: sink,
      clock,
      signingSecrets: [HIGHNOTE_SECRET],
      signatureEncoding: "hex",
      maxSignatureAgeMs: 300_000,
      maxFutureSkewMs: 30_000,
      authorizationFailurePolicy: "decline",
      logger: false,
    });
    const request = highnoteRequest({ requestId: "te_core_unavailable" });
    const { rawBody, signature } = signedBody(request);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/highnote/collaborative-authorization",
        headers: { "content-type": "application/json", "highnote-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        transaction: { id: "tx_allow_001" },
        responseCode: "INVALID_TRANSACTION",
      });
      expect(sink.bundles).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
