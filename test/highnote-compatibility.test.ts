import { describe, expect, it } from "vitest";

import type { DownstreamAuthorisationClient } from "../src/adapter/index.js";
import {
  CollaborativeAuthorizationRequestSchema,
  countSchemaIssues,
  getPointOfServiceDetails,
  highnoteRequestIdFrom,
  HighnoteEndpointPingSchema,
  summariseSchemaIssues,
} from "../src/highnote/index.js";
import { highnotePayload, highnoteRequest, signedBody, testProcessor } from "./helpers.js";

function parse(payload: unknown) {
  return CollaborativeAuthorizationRequestSchema.safeParse(payload);
}

function issuePaths(payload: unknown): string[] {
  const result = parse(payload);
  expect(result.success).toBe(false);
  return summariseSchemaIssues(result.error).map((issue) => issue.path);
}

/**
 * A downstream authorisation that approves less than the requested amount, so
 * `terminalSupportsPartialApproval` is the field that decides the outcome.
 */
const partialDownstream: DownstreamAuthorisationClient = {
  authorise: () =>
    Promise.resolve({
      allowed: true,
      responseCode: "PARTIAL_AMOUNT_APPROVED" as const,
      authorizedAmount: { value: 2500, currencyCode: "USD" },
    }),
};

describe("Highnote request schema compatibility", () => {
  it("still parses the simulation input representation", () => {
    const result = parse(highnotePayload());
    expect(result.success).toBe(true);
    const request = result.data?.data.collaborativeAuthorizationRequest;
    expect(request?.pointOfServiceDetails?.terminalSupportsPartialApproval).toBe(true);
    expect(request?.pointOfSaleDetails).toBeUndefined();
  });

  it("parses the documented callback representation", () => {
    const result = parse(highnotePayload({ pointOfSale: "sale" }));
    expect(result.success).toBe(true);
    const request = result.data?.data.collaborativeAuthorizationRequest;
    expect(request?.pointOfSaleDetails).toEqual({
      panEntryMode: "CONTACTLESS_VIA_CHIP_RULES",
      pinEntryMode: null,
      terminalAttendance: "UNATTENDED",
      isCardHolderPresent: false,
      isCardPresent: false,
      isRecurring: null,
      terminalSupportsPartialApproval: true,
    });
    expect(request?.pointOfServiceDetails).toBeUndefined();
  });

  it("accepts the documented callback point of sale optional compatibility fields", () => {
    const payload = highnotePayload({ pointOfSale: "sale" });
    const details = payload.data.collaborativeAuthorizationRequest["pointOfSaleDetails"] as Record<
      string,
      unknown
    >;
    details["category"] = "ECOMMERCE";
    details["cardDataInputCapability"] = "CONTACTLESS_READ_VIA_CHIP_RULES";
    expect(parse(payload).success).toBe(true);
  });

  it("parses a null networkRetrievalReferenceNumber", () => {
    const result = parse(highnotePayload({ networkRetrievalReferenceNumber: null }));
    expect(result.success).toBe(true);
    expect(
      result.data?.data.collaborativeAuthorizationRequest.networkRetrievalReferenceNumber,
    ).toBeNull();
  });

  it("parses a bounded non-null networkRetrievalReferenceNumber", () => {
    const result = parse(highnotePayload({ networkRetrievalReferenceNumber: "020000654321" }));
    expect(result.success).toBe(true);
    expect(
      result.data?.data.collaborativeAuthorizationRequest.networkRetrievalReferenceNumber,
    ).toBe("020000654321");
  });

  it("rejects an unbounded networkRetrievalReferenceNumber", () => {
    expect(
      issuePaths(highnotePayload({ networkRetrievalReferenceNumber: "0".repeat(65) })),
    ).toEqual(["data.collaborativeAuthorizationRequest.networkRetrievalReferenceNumber"]);
  });

  it("still rejects an arbitrary unknown request field", () => {
    const payload = highnotePayload();
    payload.data.collaborativeAuthorizationRequest["merchantRiskOverride"] = "APPROVE";
    const summaries = summariseSchemaIssues(parse(payload).error);
    expect(summaries).toEqual([
      {
        path: "data.collaborativeAuthorizationRequest",
        code: "unrecognized_keys",
        keys: ["merchantRiskOverride"],
      },
    ]);
  });

  it("still rejects an arbitrary unknown pointOfSaleDetails field", () => {
    const payload = highnotePayload({ pointOfSale: "sale" });
    const details = payload.data.collaborativeAuthorizationRequest["pointOfSaleDetails"] as Record<
      string,
      unknown
    >;
    details["terminalOverridesPolicy"] = true;
    expect(issuePaths(payload)).toEqual([
      "data.collaborativeAuthorizationRequest.pointOfSaleDetails",
    ]);
  });

  it("still rejects an arbitrary unknown pointOfServiceDetails field", () => {
    const payload = highnotePayload();
    const details = payload.data.collaborativeAuthorizationRequest[
      "pointOfServiceDetails"
    ] as Record<string, unknown>;
    details["terminalOverridesPolicy"] = true;
    expect(issuePaths(payload)).toEqual([
      "data.collaborativeAuthorizationRequest.pointOfServiceDetails",
    ]);
  });

  it("rejects a request carrying both point of sale representations as ambiguous", () => {
    const summaries = summariseSchemaIssues(parse(highnotePayload({ pointOfSale: "both" })).error);
    expect(summaries).toEqual([
      {
        path: "data.collaborativeAuthorizationRequest.pointOfSaleDetails",
        code: "custom",
      },
    ]);
  });

  it("rejects both representations even when they agree, rather than picking one", () => {
    // The two objects here carry the same `terminalSupportsPartialApproval`.
    // Accepting agreeing pairs would mean the adapter has to decide which
    // reading wins when they later disagree, so the pair is rejected outright.
    expect(
      parse(highnotePayload({ pointOfSale: "both", terminalSupportsPartialApproval: false }))
        .success,
    ).toBe(false);
  });

  it("still parses a request that omits point of sale details entirely", () => {
    const result = parse(highnotePayload({ pointOfSale: "none" }));
    expect(result.success).toBe(true);
    expect(
      getPointOfServiceDetails(result.data!.data.collaborativeAuthorizationRequest),
    ).toBeUndefined();
  });

  it.each(["service", "sale"] as const)(
    "reads point of sale semantics from %s details",
    (representation) => {
      const request = highnoteRequest({ pointOfSale: representation });
      expect(
        getPointOfServiceDetails(request.data.collaborativeAuthorizationRequest)
          ?.terminalSupportsPartialApproval,
      ).toBe(true);
    },
  );
});

describe("point of sale representation policy semantics", () => {
  it.each(["service", "sale"] as const)(
    "honours terminalSupportsPartialApproval=true supplied through %s details",
    async (representation) => {
      const request = highnoteRequest({
        pointOfSale: representation,
        terminalSupportsPartialApproval: true,
        requestId: `te_partial_${representation}`,
      });
      const { rawBody, signature } = signedBody(request);
      const processor = await testProcessor({ downstreamClient: partialDownstream });
      const result = await processor.process({ request, rawBody, highnoteSignature: signature });
      expect(result.response).toEqual({
        transaction: { id: "tx_allow_001" },
        responseCode: "PARTIAL_AMOUNT_APPROVED",
        authorizedAmount: { value: 2500, currencyCode: "USD" },
      });
    },
  );

  it.each(["service", "sale"] as const)(
    "honours terminalSupportsPartialApproval=false supplied through %s details",
    async (representation) => {
      const request = highnoteRequest({
        pointOfSale: representation,
        terminalSupportsPartialApproval: false,
        requestId: `te_no_partial_${representation}`,
      });
      const { rawBody, signature } = signedBody(request);
      const processor = await testProcessor({ downstreamClient: partialDownstream });
      const result = await processor.process({ request, rawBody, highnoteSignature: signature });
      expect(result.response).toEqual({
        transaction: { id: "tx_allow_001" },
        responseCode: "INVALID_TRANSACTION",
      });
    },
  );

  it("fails closed on partial approval when no point of sale details are supplied", async () => {
    const request = highnoteRequest({ pointOfSale: "none", requestId: "te_no_pos" });
    const { rawBody, signature } = signedBody(request);
    const processor = await testProcessor({ downstreamClient: partialDownstream });
    const result = await processor.process({ request, rawBody, highnoteSignature: signature });
    expect(result.response.responseCode).toBe("INVALID_TRANSACTION");
  });
});

describe("Highnote endpoint verification ping schema", () => {
  const ping = (value: unknown, timestamp = 1_786_640_521_401) => ({
    data: { collaborativeAuthorizationRequest: { ping: value } },
    extensions: { signatureTimestamp: timestamp },
  });

  it.each([
    ["boolean", true],
    ["string", "ping"],
    ["number", 1],
    ["null", null],
    ["object", { nonce: "abc" }],
  ])("accepts an undocumented %s ping value", (_label, value) => {
    expect(HighnoteEndpointPingSchema.safeParse(ping(value)).success).toBe(true);
  });

  it("requires the ping key to be present", () => {
    expect(
      HighnoteEndpointPingSchema.safeParse({
        data: { collaborativeAuthorizationRequest: {} },
        extensions: { signatureTimestamp: 1_786_640_521_401 },
      }).success,
    ).toBe(false);
  });

  it("accepts opaque metadata beside ping", () => {
    expect(
      HighnoteEndpointPingSchema.safeParse({
        data: { collaborativeAuthorizationRequest: { ping: true, nonce: "abc" } },
        extensions: { signatureTimestamp: 1_786_640_521_401 },
      }).success,
    ).toBe(true);
  });

  it("rejects every authorisation marker beside ping", () => {
    for (const marker of [
      "transaction",
      "paymentCard",
      "transactionAmount",
      "settlementAmount",
      "requestedAmount",
      "surchargeFee",
      "merchantDetails",
      "responseCode",
      "transactionTimestamp",
      "avsResponseCode",
      "postalCodeResponseCode",
      "cvvResponseCode",
      "pointOfServiceDetails",
      "pointOfSaleDetails",
      "networkRetrievalReferenceNumber",
      "additionalNetworkData",
      "cashBackAmount",
      "createdAt",
    ]) {
      expect(
        HighnoteEndpointPingSchema.safeParse({
          data: { collaborativeAuthorizationRequest: { ping: true, [marker]: null } },
          extensions: { signatureTimestamp: 1_786_640_521_401 },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects the authorisation typename beside ping", () => {
    expect(
      HighnoteEndpointPingSchema.safeParse({
        data: {
          collaborativeAuthorizationRequest: {
            ping: true,
            __typename: "PaymentCardAuthorizationRequest",
          },
        },
        extensions: { signatureTimestamp: 1_786_640_521_401 },
      }).success,
    ).toBe(false);
  });

  it("requires a signature timestamp so the freshness window still applies", () => {
    expect(
      HighnoteEndpointPingSchema.safeParse({
        data: { collaborativeAuthorizationRequest: { ping: true } },
        extensions: {},
      }).success,
    ).toBe(false);
  });

  it("never matches an authorisation request, in either representation", () => {
    for (const representation of ["service", "sale"] as const) {
      expect(
        HighnoteEndpointPingSchema.safeParse(highnotePayload({ pointOfSale: representation }))
          .success,
      ).toBe(false);
    }
  });

  it("never matches a malformed or truncated authorisation request", () => {
    // This is the property that keeps the probe path from becoming a bypass:
    // a broken authorisation request must not fall through to a 2xx.
    const truncated = highnotePayload();
    delete truncated.data.collaborativeAuthorizationRequest["merchantDetails"];
    for (const payload of [
      truncated,
      { data: { collaborativeAuthorizationRequest: {} }, extensions: { signatureTimestamp: 1 } },
      { data: {}, extensions: { signatureTimestamp: 1 } },
      {},
    ]) {
      expect(HighnoteEndpointPingSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("is not accepted by the authorisation schema", () => {
    expect(parse(ping(true)).success).toBe(false);
  });
});

describe("sanitised schema diagnostics", () => {
  it("never carries request values", () => {
    const payload = highnotePayload();
    payload.data.collaborativeAuthorizationRequest["paymentCard"] = { id: 4111_1111_1111_1111 };
    const serialised = JSON.stringify(summariseSchemaIssues(parse(payload).error));
    expect(serialised).toContain("invalid_type");
    expect(serialised).toContain("paymentCard.id");
    expect(serialised).not.toContain("4111");
  });

  it("reports the expected category for a type mismatch", () => {
    const payload = highnotePayload();
    payload.data.collaborativeAuthorizationRequest["id"] = 17;
    expect(summariseSchemaIssues(parse(payload).error)).toEqual([
      {
        path: "data.collaborativeAuthorizationRequest.id",
        code: "invalid_type",
        expected: "string",
      },
    ]);
  });

  it("bounds the number of reported issues, keys and token length", () => {
    const payload = highnotePayload();
    for (let index = 0; index < 20; index += 1) {
      payload.data.collaborativeAuthorizationRequest[`unknown_${index}`] = index;
    }
    payload.data.collaborativeAuthorizationRequest[`unknown_${"x".repeat(80)}`] = 1;
    const summaries = summariseSchemaIssues(parse(payload).error);
    expect(summaries.length).toBeLessThanOrEqual(10);
    for (const summary of summaries) {
      expect(summary.keys?.length ?? 0).toBeLessThanOrEqual(10);
      for (const key of summary.keys ?? []) expect(key.length).toBeLessThanOrEqual(67);
    }
  });

  it("keeps unrecognised key names when a payload is the wrong kind of object", () => {
    // A payload whose authorization request carries none of the expected fields
    // produces one issue per missing field before Zod ever reports the
    // unrecognised keys. The key names are the only evidence of what the sender
    // actually supplied, so they must survive truncation.
    const payload = {
      data: {
        collaborativeAuthorizationRequest: { verificationType: "PING", nonce: "abc" },
      },
      extensions: { signatureTimestamp: 1_786_639_839_319 },
    };
    const error = parse(payload).error;
    expect(countSchemaIssues(error)).toBeGreaterThan(10);
    const summaries = summariseSchemaIssues(error);
    expect(summaries.length).toBe(10);
    expect(summaries[0]).toEqual({
      path: "data.collaborativeAuthorizationRequest",
      code: "unrecognized_keys",
      keys: ["verificationType", "nonce"],
    });
  });

  it("counts every issue even when the summary is truncated", () => {
    const payload = {
      data: { collaborativeAuthorizationRequest: {} },
      extensions: { signatureTimestamp: 1_786_639_839_319 },
    };
    const error = parse(payload).error;
    expect(countSchemaIssues(error)).toBe(15);
    expect(summariseSchemaIssues(error)).toHaveLength(10);
    expect(countSchemaIssues(undefined)).toBe(0);
    expect(countSchemaIssues(new Error("boom"))).toBe(0);
  });

  it("returns nothing for a value that is not a Zod error", () => {
    expect(summariseSchemaIssues(undefined)).toEqual([]);
    expect(summariseSchemaIssues(null)).toEqual([]);
    expect(summariseSchemaIssues(new Error("boom"))).toEqual([]);
    expect(summariseSchemaIssues({ issues: [null, { code: 7, path: [Symbol("s")] }] })).toEqual([
      { path: "<root>", code: "unknown" },
      { path: "?", code: "unknown" },
    ]);
  });

  it("extracts only a bounded Highnote request id from a rejected payload", () => {
    const payload = highnotePayload();
    payload.data.collaborativeAuthorizationRequest["merchantRiskOverride"] = "APPROVE";
    expect(highnoteRequestIdFrom(payload)).toBe("te_allow_001");
    expect(highnoteRequestIdFrom({ data: {} })).toBeUndefined();
    expect(highnoteRequestIdFrom("not an object")).toBeUndefined();
    expect(
      highnoteRequestIdFrom({
        data: { collaborativeAuthorizationRequest: { id: "x".repeat(129) } },
      }),
    ).toBeUndefined();
  });
});
