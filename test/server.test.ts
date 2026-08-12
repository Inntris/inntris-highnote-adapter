import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { HighnoteAuthorisationProcessor } from "../src/adapter/index.js";
import { CollectingEvidenceSink } from "../src/evidence/index.js";
import { AdapterMetrics } from "../src/metrics.js";
import {
  clock,
  FIXED_NOW,
  HIGHNOTE_SECRET,
  highnoteRequest,
  signedBody,
  testProcessor,
} from "./helpers.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

async function app(processor?: HighnoteAuthorisationProcessor) {
  const sink = new CollectingEvidenceSink();
  const instance = buildApp({
    processor: processor ?? (await testProcessor()),
    evidenceSink: sink,
    clock,
    signingSecrets: [HIGHNOTE_SECRET],
    signatureEncoding: "hex",
    maxSignatureAgeMs: 300_000,
    maxFutureSkewMs: 30_000,
    metrics: new AdapterMetrics(false),
    logger: false,
  });
  apps.push(instance);
  return { instance, sink };
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

  it("exposes liveness, readiness and Prometheus metrics", async () => {
    const { instance } = await app();
    expect((await instance.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await instance.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    const metrics = await instance.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("requests_total");
  });
});
