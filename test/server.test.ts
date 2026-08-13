import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { HighnoteAuthorisationProcessor } from "../src/adapter/index.js";
import type { AuthorizationFailurePolicy } from "../src/errors.js";
import { CollectingEvidenceSink } from "../src/evidence/index.js";
import { SnapshotMandateStore } from "../src/mandates/index.js";
import { AdapterMetrics } from "../src/metrics.js";
import {
  clock,
  FIXED_NOW,
  HIGHNOTE_SECRET,
  highnotePayload,
  highnoteRequest,
  signedBody,
  signedPayload,
  signer,
  testProcessor,
} from "./helpers.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

async function app(
  processor?: HighnoteAuthorisationProcessor,
  authorizationFailurePolicy?: AuthorizationFailurePolicy,
) {
  const sink = new CollectingEvidenceSink();
  const metrics = new AdapterMetrics(false);
  const instance = buildApp({
    processor: processor ?? (await testProcessor()),
    evidenceSink: sink,
    clock,
    signingSecrets: [HIGHNOTE_SECRET],
    signatureEncoding: "hex",
    maxSignatureAgeMs: 300_000,
    maxFutureSkewMs: 30_000,
    ...(authorizationFailurePolicy === undefined ? {} : { authorizationFailurePolicy }),
    metrics,
    logger: false,
  });
  apps.push(instance);
  return { instance, sink, metrics };
}

function post(instance: ReturnType<typeof buildApp>, rawBody: Buffer, signature: string) {
  return instance.inject({
    method: "POST",
    url: "/v1/highnote/collaborative-authorization",
    headers: { "content-type": "application/json", "highnote-signature": signature },
    payload: rawBody,
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (instance) => instance.close()));
});

describe("HTTP adapter", () => {
  it("returns a valid Highnote approval", async () => {
    const { instance } = await app();
    const request = highnoteRequest();
    const { rawBody, signature } = signedBody(request);
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: { "content-type": "application/json", "highnote-signature": signature },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ responseCode: "APPROVED" });
  });

  it("returns a 2XX decline for an organisational policy block", async () => {
    const { instance } = await app();
    const request = highnoteRequest({ amount: 10001, requestId: "te_http_block" });
    const { rawBody, signature } = signedBody(request);
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: { "content-type": "application/json", "highnote-signature": signature },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ responseCode: "EXCEEDS_LIMIT" });
  });

  it("authorises a signed request in the documented Highnote callback representation", async () => {
    // Reproduces the shape that reached the deployed adapter on 13 August 2026:
    // HMAC verification passed and strict schema parsing then rejected the
    // request as INVALID_REQUEST_SCHEMA. The same authenticated boundary is
    // exercised here, with no activation special case.
    const { instance, metrics } = await app();
    const payload = highnotePayload({
      pointOfSale: "sale",
      networkRetrievalReferenceNumber: "020000654321",
      requestId: "te_callback_001",
    });
    const { rawBody, signature } = signedPayload(payload);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      transaction: { id: "tx_allow_001" },
      responseCode: "APPROVED",
    });
    const scraped = await metrics.registry.metrics();
    // Authenticity, schema and freshness all passed, and the processor decided.
    expect(scraped).toContain('highnote_request_verification_total{result="valid"} 1');
    expect(scraped).toContain('policy_decision_total{verdict="ALLOW"} 1');
    expect(scraped).toContain('requests_total{result="APPROVED"} 1');
  });

  it("rejects an authenticated request carrying both point of sale representations", async () => {
    const { instance } = await app();
    const { rawBody, signature } = signedPayload(
      highnotePayload({ pointOfSale: "both", requestId: "te_ambiguous_001" }),
    );
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST_SCHEMA", message: "Request schema validation failed" },
    });
  });

  it("acknowledges a signed Highnote endpoint verification ping", async () => {
    // The minimum shape evidenced when Highnote activated the registered
    // endpoint on 13 August 2026: a signed probe carrying `ping`.
    const { instance, sink, metrics } = await app();
    const { rawBody, signature } = signedPayload({
      data: { collaborativeAuthorizationRequest: { ping: true } },
      extensions: { signatureTimestamp: FIXED_NOW.getTime() },
    });
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ping: "ok" });
    const scraped = await metrics.registry.metrics();
    expect(scraped).toContain('highnote_request_verification_total{result="valid"} 1');
    expect(scraped).toContain('requests_total{result="ping"} 1');
    // A probe asks no authority question, so nothing is decided or bound.
    expect(scraped).not.toContain("policy_decision_total{");
    expect(sink.bundles).toHaveLength(0);
  });

  it("acknowledges a signed Highnote verification ping carrying opaque metadata", async () => {
    // Railway exposed only keys[0] from Highnote's unrecognised-key list. The
    // real activation request can therefore contain authenticated probe
    // metadata after `ping` that the structured log renderer did not show.
    const { instance, sink } = await app();
    const { rawBody, signature } = signedPayload({
      data: {
        collaborativeAuthorizationRequest: {
          ping: true,
          __typename: "CollaborativeAuthorizationEndpointProbe",
          id: "probe_001",
          nonce: "activation-probe",
        },
      },
      extensions: { signatureTimestamp: FIXED_NOW.getTime() },
    });
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ping: "ok" });
    expect(sink.bundles).toHaveLength(0);
  });

  it("rejects an unsigned verification ping", async () => {
    const { instance } = await app();
    const { rawBody } = signedPayload({
      data: { collaborativeAuthorizationRequest: { ping: true } },
      extensions: { signatureTimestamp: FIXED_NOW.getTime() },
    });
    const response = await post(instance, rawBody, "00".repeat(32));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  });

  it("rejects a stale verification ping", async () => {
    const { instance } = await app();
    const { rawBody, signature } = signedPayload({
      data: { collaborativeAuthorizationRequest: { ping: true } },
      extensions: { signatureTimestamp: FIXED_NOW.getTime() - 300_001 },
    });
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "STALE_REQUEST" } });
  });

  it("does not let a malformed authorisation request fall through to a ping 2XX", async () => {
    const { instance } = await app();
    const payload = highnotePayload({ requestId: "te_truncated_001" });
    delete payload.data.collaborativeAuthorizationRequest["merchantDetails"];
    const { rawBody, signature } = signedPayload(payload);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_SCHEMA" } });
  });

  it("does not let a malformed authorisation carrying ping fall through to a probe 2XX", async () => {
    const { instance } = await app();
    const payload = highnotePayload({ requestId: "te_truncated_ping_001" });
    payload.data.collaborativeAuthorizationRequest["ping"] = true;
    delete payload.data.collaborativeAuthorizationRequest["merchantDetails"];
    const { rawBody, signature } = signedPayload(payload);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_SCHEMA" } });
  });

  it("returns a client error for malformed JSON", async () => {
    const { instance } = await app();
    const response = await post(instance, Buffer.from("{not json", "utf8"), "00".repeat(32));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON" },
    });
  });

  it("preserves the payload-too-large status from Fastify", async () => {
    const { instance } = await app();
    const oversized = Buffer.from(JSON.stringify({ pad: "x".repeat(300 * 1024) }), "utf8");
    const response = await post(instance, oversized, "00".repeat(32));
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit" },
    });
  });

  it("rejects an invalid signature", async () => {
    const { instance } = await app();
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: { "content-type": "application/json", "highnote-signature": "00".repeat(32) },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  });

  it("rejects a stale signed request before policy evaluation", async () => {
    const { instance } = await app();
    const request = highnoteRequest({
      requestId: "te_stale",
      signatureTimestamp: FIXED_NOW.getTime() - 300_001,
    });
    const { rawBody, signature } = signedBody(request);
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: { "content-type": "application/json", "highnote-signature": signature },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "STALE_REQUEST" } });
  });

  it("rejects a malformed authenticated request", async () => {
    const { instance } = await app();
    const rawBody = Buffer.from("{}", "utf8");
    const { createHighnoteSignature } = await import("../src/highnote/index.js");
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: {
        "content-type": "application/json",
        "highnote-signature": createHighnoteSignature(rawBody, HIGHNOTE_SECRET, "hex"),
      },
      payload: rawBody,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_SCHEMA" } });
  });

  it("declines rather than deferring to Highnote stand-in when no mandate matches", async () => {
    const { instance, metrics } = await app();
    const request = highnoteRequest({ paymentCardId: "card_unmapped_999", requestId: "te_no_map" });
    const { rawBody, signature } = signedBody(request);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      transaction: { id: "tx_allow_001" },
      responseCode: "INVALID_TRANSACTION",
    });
    const scraped = await metrics.registry.metrics();
    expect(scraped).toContain(
      'authorization_failure_total{code="MANDATE_NOT_FOUND",policy="decline"} 1',
    );
  });

  it("defers to Highnote stand-in only when the operator opts in", async () => {
    const { instance } = await app(undefined, "stand_in");
    const request = highnoteRequest({ paymentCardId: "card_unmapped_999", requestId: "te_no_map" });
    const { rawBody, signature } = signedBody(request);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "MANDATE_NOT_FOUND" } });
  });

  it("counts each request once on the verification and request counters", async () => {
    const { instance, metrics } = await app();
    const request = highnoteRequest({ paymentCardId: "card_unmapped_999", requestId: "te_once" });
    const { rawBody, signature } = signedBody(request);
    await post(instance, rawBody, signature);
    const scraped = await metrics.registry.metrics();
    const verification = scraped
      .split("\n")
      .filter((line) => line.startsWith("highnote_request_verification_total{"));
    // An authenticated request that later fails must not also be counted as a
    // verification failure on the same counter.
    expect(verification).toEqual(['highnote_request_verification_total{result="valid"} 1']);
    expect(scraped).toContain('requests_total{result="INVALID_TRANSACTION"} 1');
  });

  it("counts an unauthenticated request as rejected and never as valid", async () => {
    const { instance, metrics } = await app();
    const { rawBody } = signedBody(highnoteRequest());
    await post(instance, rawBody, "00".repeat(32));
    const scraped = await metrics.registry.metrics();
    expect(scraped).toContain('highnote_request_verification_total{result="INVALID_SIGNATURE"} 1');
    expect(scraped).not.toContain('highnote_request_verification_total{result="valid"}');
    expect(scraped).toContain('requests_total{result="rejected"} 1');
  });

  it("exposes liveness, readiness and Prometheus metrics", async () => {
    const { instance } = await app();
    expect((await instance.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await instance.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    const metrics = await instance.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("requests_total");
  });

  it("reports not ready when the mandate snapshot resolves no records", async () => {
    const emptyStore = new SnapshotMandateStore({
      version: "inntris-highnote-mandate-snapshot-v1",
      generated_at: FIXED_NOW.toISOString(),
      records: [],
    });
    const { instance } = await app(
      new HighnoteAuthorisationProcessor({
        mandateStore: emptyStore,
        signer,
        clock,
        actionResource: "https://adapter.example.test/v1/highnote/collaborative-authorization",
      }),
    );
    const ready = await instance.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not_ready" });
    expect((await instance.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });
});
