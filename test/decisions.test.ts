import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CollectingEvidenceSink } from "../src/evidence/index.js";
import { AdapterMetrics } from "../src/metrics.js";
import {
  FIXED_NOW,
  HIGHNOTE_SECRET,
  clock,
  highnoteRequest,
  signedBody,
  testProcessor,
  testSimulatorMandate,
} from "./helpers.js";

async function simulatorScenario(input: {
  label: "allow" | "block";
  amount: number;
  issuedAt: Date;
}) {
  const mandate = await testSimulatorMandate();
  const request = highnoteRequest({
    paymentCardId: mandate.payment_card_id,
    requestId: `te_read_model_${input.label}`,
    transactionId: `tx_read_model_${input.label}`,
    amount: input.amount,
    merchantId: "",
    merchantName: "HIGHNOTE_PLATFORM",
    merchantCategoryCode: "1520",
    merchantCategory: "GENERAL_SERVICES",
    preliminaryResponseCode: null,
  });
  const rawMarker = `RAW_HIGHNOTE_${input.label.toUpperCase()}_DO_NOT_EXPOSE`;
  request.data.collaborativeAuthorizationRequest.merchantDetails.description = rawMarker;
  const address = request.data.collaborativeAuthorizationRequest.merchantDetails.address;
  if (address !== null) address.streetAddress = `${rawMarker}_ADDRESS`;
  const signed = signedBody(request);
  const processor = await testProcessor({
    clock: { now: () => new Date(input.issuedAt) },
    decisionIdFactory: () => `decision-read-model-${input.label}`,
    nonceFactory: () => `bm9uY2UtcmVhZC1tb2RlbC0${input.label === "allow" ? "x" : "y"}`,
    bundleIdFactory: () => `bundle-read-model-${input.label}`,
  });
  const processed = await processor.process({
    request,
    rawBody: signed.rawBody,
    highnoteSignature: signed.signature,
  });
  return {
    processed,
    request,
    rawBody: signed.rawBody,
    highnoteSignature: signed.signature,
    rawMarker,
  };
}

type Scenario = Awaited<ReturnType<typeof simulatorScenario>>;

describe("Inntris decision read surface", () => {
  let repository: CollectingEvidenceSink;
  let instance: FastifyInstance;
  let allow: Scenario;
  let block: Scenario;

  beforeEach(async () => {
    allow = await simulatorScenario({ label: "allow", amount: 5_000, issuedAt: FIXED_NOW });
    block = await simulatorScenario({
      label: "block",
      amount: 25_000,
      issuedAt: new Date(FIXED_NOW.getTime() + 1_000),
    });
    repository = new CollectingEvidenceSink();
    await repository.write(allow.processed.bundle);
    await repository.write(block.processed.bundle);
    instance = buildApp({
      processor: await testProcessor(),
      evidenceSink: repository,
      clock,
      signingSecrets: [HIGHNOTE_SECRET],
      signatureEncoding: "hex",
      maxSignatureAgeMs: 300_000,
      maxFutureSkewMs: 30_000,
      metrics: new AdapterMetrics(false),
      logger: false,
    });
  });

  afterEach(async () => {
    await instance.close();
  });

  it("lists safe summaries newest first", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions?provider=highnote&limit=10",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ decisions: Array<Record<string, unknown>>; count: number }>();
    expect(body.count).toBe(2);
    expect(body.decisions.map((decision) => decision["decision_id"])).toEqual([
      "decision-read-model-block",
      "decision-read-model-allow",
    ]);
    expect(Object.keys(body.decisions[0]!).sort()).toEqual(
      [
        "decision_id",
        "verdict",
        "reason_codes",
        "action_hash",
        "amount",
        "currency",
        "merchant",
        "merchant_category",
        "mandate_id",
        "policy_version",
        "highnote_request_id",
        "highnote_transaction_id",
        "highnote_response_code",
        "created_at",
        "signature_verified",
        "freshness_verified",
        "evidence_bundle_id",
      ].sort(),
    );
  });

  it("returns verified ALLOW evidence for USD 50 and MCC 1520", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions/decision-read-model-allow",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision_id: "decision-read-model-allow",
      verdict: "ALLOW",
      reason_codes: ["MERCHANT_ALLOWED", "WITHIN_TRANSACTION_LIMIT"],
      action_hash: allow.processed.decision.action_hash,
      amount: "50.00",
      currency: "USD",
      merchant: "HIGHNOTE_PLATFORM",
      merchant_category: "1520",
      highnote_request_id: "te_read_model_allow",
      highnote_transaction_id: "tx_read_model_allow",
      highnote_response_code: "APPROVED",
      signature_verified: true,
      freshness_verified: true,
      evidence_bundle_id: "bundle-read-model-allow",
      evidence_integrity: "VERIFIED",
      evidence_checks: {
        schema: true,
        bundle_signature: true,
        key_registry: true,
        decision: true,
        highnote_binding: true,
        source_payload_binding: true,
      },
      action: { transaction: { payee: "name:HIGHNOTE_PLATFORM" } },
    });
  });

  it("returns verified BLOCK evidence for USD 250 and MCC 1520", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions/decision-read-model-block",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision_id: "decision-read-model-block",
      verdict: "BLOCK",
      reason_codes: ["AMOUNT_EXCEEDS_TRANSACTION_LIMIT"],
      action_hash: block.processed.decision.action_hash,
      amount: "250.00",
      currency: "USD",
      merchant: "HIGHNOTE_PLATFORM",
      merchant_category: "1520",
      highnote_request_id: "te_read_model_block",
      highnote_transaction_id: "tx_read_model_block",
      highnote_response_code: "EXCEEDS_LIMIT",
      evidence_bundle_id: "bundle-read-model-block",
      evidence_integrity: "VERIFIED",
    });
  });

  it("filters decision lists by verdict", async () => {
    for (const verdict of ["ALLOW", "BLOCK"] as const) {
      const response = await instance.inject({
        method: "GET",
        url: `/v1/inntris/decisions?verdict=${verdict}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ decisions: Array<{ verdict: string }> }>();
      expect(body.decisions).toHaveLength(1);
      expect(body.decisions.every((decision) => decision.verdict === verdict)).toBe(true);
    }
  });

  it("resolves a decision by Highnote request ID", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions/by-highnote-request/te_read_model_block",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision_id: "decision-read-model-block",
      highnote_request_id: "te_read_model_block",
      evidence_integrity: "VERIFIED",
    });
  });

  it("never exposes the raw Highnote payload, HMAC signature, card ID or secrets", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions/decision-read-model-allow",
    });
    const serialised = response.body;
    expect(serialised).not.toContain(allow.rawMarker);
    expect(serialised).not.toContain(allow.highnoteSignature);
    expect(serialised).not.toContain(
      allow.request.data.collaborativeAuthorizationRequest.paymentCard.id,
    );
    expect(serialised).not.toContain(HIGHNOTE_SECRET);
    expect(serialised).not.toContain("rawJsonBody");
    expect(serialised).not.toContain("signingSeed");
    expect(serialised).not.toContain("endpointSecret");
  });

  it("reports tampered evidence as INVALID without hiding the decision", async () => {
    const tampered = structuredClone(allow.processed.bundle);
    tampered.decision.decision_id = "decision-read-model-tampered";
    tampered.action.transaction.amount = "51.00";
    await repository.write(tampered);
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions/decision-read-model-tampered",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision_id: "decision-read-model-tampered",
      evidence_integrity: "INVALID",
      evidence_checks: { bundle_signature: false, decision: false },
    });
  });

  it("renders human readable list and detail pages", async () => {
    const list = await instance.inject({ method: "GET", url: "/inntris/decisions" });
    expect(list.statusCode).toBe(200);
    expect(list.headers["content-type"]).toContain("text/html");
    expect(list.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(list.body).toContain("Inntris Decisions");
    expect(list.body).toContain("ALLOW");
    expect(list.body).toContain("BLOCK");
    expect(list.body).toContain("HIGHNOTE_PLATFORM");
    expect(list.body).toContain("/inntris/decisions/decision-read-model-allow");

    const detail = await instance.inject({
      method: "GET",
      url: "/inntris/decisions/decision-read-model-allow",
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Inntris Decision");
    expect(detail.body).toContain("Evidence integrity");
    expect(detail.body).toContain("VERIFIED");
    expect(detail.body).not.toContain(allow.rawMarker);
  });

  it("enforces the decision list limit ceiling", async () => {
    const response = await instance.inject({
      method: "GET",
      url: "/v1/inntris/decisions?limit=101",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_QUERY", message: "Decision query is invalid" },
    });
  });
});
