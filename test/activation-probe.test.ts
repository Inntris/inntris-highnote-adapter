import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CollectingEvidenceSink } from "../src/evidence/index.js";
import { AdapterMetrics } from "../src/metrics.js";
import { clock, FIXED_NOW, HIGHNOTE_SECRET, signedPayload, testProcessor } from "./helpers.js";

/**
 * Validation-pass reproduction of the Highnote endpoint activation failure.
 *
 * These tests characterise the route boundary. They do not modify handler
 * code. Each asserts the behaviour actually observed, so a later change that
 * alters any of it fails here first.
 */

const apps: Array<ReturnType<typeof buildApp>> = [];

async function app() {
  const instance = buildApp({
    processor: await testProcessor(),
    evidenceSink: new CollectingEvidenceSink(),
    clock,
    signingSecrets: [HIGHNOTE_SECRET],
    signatureEncoding: "hex",
    maxSignatureAgeMs: 300_000,
    maxFutureSkewMs: 30_000,
    metrics: new AdapterMetrics(false),
    logger: false,
  });
  apps.push(instance);
  return instance;
}

function post(instance: ReturnType<typeof buildApp>, rawBody: Buffer, signature?: string) {
  return instance.inject({
    method: "POST",
    url: "/v1/highnote/collaborative-authorization",
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { "highnote-signature": signature }),
    },
    payload: rawBody,
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (instance) => instance.close()));
});

describe("activation probe: the body exactly as the brief specifies it", () => {
  it("is rejected 401, not 400, because it carries no signature header", async () => {
    // The brief predicted 400. The route verifies authenticity before any
    // schema work, so an unsigned body never reaches schema validation at all.
    const instance = await app();
    const rawBody = Buffer.from(
      JSON.stringify({ data: { collaborativeAuthorizationRequest: { ping: true } } }),
      "utf8",
    );
    const response = await post(instance, rawBody);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "MISSING_SIGNATURE" } });
  });

  it("is rejected 400 when signed, because it omits extensions.signatureTimestamp", async () => {
    // Signed, so it clears authenticity. It still fails schema because the
    // brief's body has no `extensions`, which every message type requires so
    // that the freshness window can be applied.
    const instance = await app();
    const { rawBody, signature } = signedPayload({
      data: { collaborativeAuthorizationRequest: { ping: true } },
    });
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_SCHEMA" } });
  });
});

describe("activation probe: the body as the deployed log evidences it", () => {
  const probeBody = (
    request: Record<string, unknown>,
    timestamp: number = FIXED_NOW.getTime(),
  ) => ({
    data: { collaborativeAuthorizationRequest: request },
    extensions: { signatureTimestamp: timestamp },
  });

  it("is answered 2XX when signed and fresh", async () => {
    const instance = await app();
    const { rawBody, signature } = signedPayload(probeBody({ ping: true }));
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
  });

  it("REGRESSION RISK: a probe carrying a second key is still rejected 400", async () => {
    // The log showed `keys[0]: ping` and nothing after it, but the renderer
    // cut the line at that point and the summary was capped at 10 issues, so
    // `keys[1..]` cannot be ruled out. If the real probe carries any further
    // key, the deployed handler still fails closed exactly as it does here.
    const instance = await app();
    const { rawBody, signature } = signedPayload(probeBody({ ping: true, nonce: "abc" }));
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST_SCHEMA" } });
  });

  it("REGRESSION RISK: a probe under any other key name is rejected 400", async () => {
    // The current handler keys on the literal name `ping`. A probe named
    // anything else does not match, which is the shape-agnosticism gap.
    const instance = await app();
    const { rawBody, signature } = signedPayload(probeBody({ healthCheck: true }));
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(400);
  });

  it("reproduces the deployed 16-issue signature for an empty request object", async () => {
    // 15 missing-field issues + 1 unrecognized_keys = the logged
    // schema_issue_count of 16, confirming the arithmetic in claim C2.
    const { CollaborativeAuthorizationRequestSchema } = await import("../src/highnote/index.js");
    const empty = CollaborativeAuthorizationRequestSchema.safeParse(probeBody({}));
    expect(empty.success).toBe(false);
    expect(empty.error?.issues).toHaveLength(15);
    const withProbe = CollaborativeAuthorizationRequestSchema.safeParse(probeBody({ ping: true }));
    expect(withProbe.error?.issues).toHaveLength(16);
    const unrecognised = withProbe.error?.issues.find((i) => i.code === "unrecognized_keys");
    expect(unrecognised).toMatchObject({ keys: ["ping"] });
    // The issue count is identical whether the probe carries one key or five,
    // so schema_issue_count: 16 does not bound the number of probe keys.
    const many = CollaborativeAuthorizationRequestSchema.safeParse(
      probeBody({ ping: true, a: 1, b: 2, c: 3, d: 4 }),
    );
    expect(many.error?.issues).toHaveLength(16);
  });
});

describe("documented Highnote US example authorization payload", () => {
  /**
   * Reconstructed from this repository's own fixture corpus, NOT fetched from
   * docs.highnote.com, which is unreachable from this environment. Treat the
   * result as evidence about the fixture shape, not as verification against
   * Highnote's canonical published example.
   */
  const usExample = {
    data: {
      collaborativeAuthorizationRequest: {
        __typename: "PaymentCardAuthorizationRequest",
        id: "te_us_example_001",
        transaction: { id: "tx_us_example_001" },
        transactionTimestamp: "2026-08-12T11:59:59.900Z",
        paymentCard: { id: "card_allow_001" },
        transactionAmount: { value: 5000, currencyCode: "USD" },
        settlementAmount: { value: 5000, currencyCode: "USD" },
        requestedAmount: { value: 5000, currencyCode: "USD" },
        surchargeFee: null,
        merchantDetails: {
          merchantId: "merchant_allowed_001",
          category: "MISCELLANEOUS_SPECIALTY_RETAIL",
          categoryCode: "7399",
          countryCodeAlpha3: "USA",
          description: "TEST BUSINESS SERVICES",
          name: "TEST BUSINESS SERVICES",
          address: {
            streetAddress: "",
            extendedAddress: null,
            postalCode: "94107",
            region: "CA",
            locality: "SAN FRANCISCO",
            countryCodeAlpha3: "USA",
          },
        },
        responseCode: "APPROVED",
        avsResponseCode: "MATCH",
        postalCodeResponseCode: "MATCH",
        cvvResponseCode: "MATCH",
        createdAt: "2026-08-12T11:59:59.900Z",
      },
    },
    extensions: { signatureTimestamp: FIXED_NOW.getTime() },
  };

  it("is accepted unmodified, with the optional objects omitted entirely", async () => {
    // cashBackAmount, pointOfServiceDetails and additionalNetworkData are
    // absent rather than null, which is how Highnote documents omission.
    const instance = await app();
    const { rawBody, signature } = signedPayload(usExample);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ responseCode: "APPROVED" });
  });

  it("accepts a numeric cross-border region", async () => {
    const instance = await app();
    const crossBorder = structuredClone(usExample);
    crossBorder.data.collaborativeAuthorizationRequest.id = "te_cross_border_001";
    (
      crossBorder.data.collaborativeAuthorizationRequest.merchantDetails.address as Record<
        string,
        unknown
      >
    )["region"] = 67;
    const { rawBody, signature } = signedPayload(crossBorder);
    const response = await post(instance, rawBody, signature);
    expect(response.statusCode).toBe(200);
  });
});

describe("enumerated non-2XX exits from the route", () => {
  it("DEFECT: returns 500 for a body that is not parseable JSON, where 400 is correct", async () => {
    // The content type parser hands the bare SyntaxError from JSON.parse to
    // done(), and the error handler only special-cases AdapterError and
    // ZodError, so a client error is reported as an adapter fault.
    const instance = await app();
    const response = await post(instance, Buffer.from("{not json", "utf8"), "00".repeat(32));
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("DEFECT: returns 500 for a body over the 256 KiB limit, where 413 is correct", async () => {
    // Fastify raises FST_ERR_CTP_BODY_TOO_LARGE carrying statusCode 413. The
    // error handler discards that statusCode and substitutes 500.
    const instance = await app();
    const oversized = Buffer.from(JSON.stringify({ pad: "x".repeat(300 * 1024) }), "utf8");
    const response = await post(instance, oversized, "00".repeat(32));
    expect(response.statusCode).toBe(500);
  });

  it("returns 400 for an unsupported content type", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization",
      headers: { "content-type": "text/plain", "highnote-signature": "00".repeat(32) },
      payload: "ping",
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for a near-miss path", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/highnote/collaborative-authorization/",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 503 when no signing secret is configured", async () => {
    const instance = buildApp({
      processor: await testProcessor(),
      evidenceSink: new CollectingEvidenceSink(),
      clock,
      signingSecrets: [],
      signatureEncoding: "hex",
      maxSignatureAgeMs: 300_000,
      maxFutureSkewMs: 30_000,
      metrics: new AdapterMetrics(false),
      logger: false,
    });
    apps.push(instance);
    const response = await post(instance, Buffer.from("{}", "utf8"), "00".repeat(32));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "AUTHENTICITY_UNAVAILABLE" } });
  });

  it("returns 401 for a signature that is not well formed hex", async () => {
    const instance = await app();
    const response = await post(instance, Buffer.from("{}", "utf8"), "not-a-signature");
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_SIGNATURE_FORMAT" } });
  });
});
