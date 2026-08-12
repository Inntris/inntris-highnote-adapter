import { describe, expect, it } from "vitest";

import { actionFromHighnote, minorAmountToCanonical } from "../src/adapter/index.js";
import { evaluateMandate } from "../src/mandates/index.js";
import {
  FIXED_NOW,
  highnoteRequest,
  signedBody,
  testMandateStore,
  testProcessor,
} from "./helpers.js";

describe("Highnote card action and mandate policy", () => {
  it.each([
    [5000, "USD", "50.00"],
    [1, "USD", "0.01"],
    [1000, "JPY", "1000.00"],
    [12340, "KWD", "12.34"],
  ])("maps %s minor units of %s to %s", (minor, currency, expected) => {
    expect(minorAmountToCanonical(minor, currency)).toBe(expected);
  });

  it("creates an ALLOW decision for a valid mandate", async () => {
    const request = highnoteRequest();
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({
      request,
      rawBody,
      highnoteSignature: signature,
    });
    expect(result.decision.verdict).toBe("ALLOW");
    expect(result.response.responseCode).toBe("APPROVED");
    expect(result.bundle.action.rail).toBe("card");
    expect(result.bundle.action.extensions?.["provider"]).toBe("highnote");
  });

  it("blocks an amount above the organisational limit", async () => {
    const request = highnoteRequest({ amount: 10001, requestId: "te_amount_block" });
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    expect(result.decision.verdict).toBe("BLOCK");
    expect(result.decision.reason_codes).toContain("AMOUNT_EXCEEDS_TRANSACTION_LIMIT");
    expect(result.response.responseCode).toBe("EXCEEDS_LIMIT");
  });

  it("blocks a merchant outside the mandate", async () => {
    const request = highnoteRequest({
      merchantId: "merchant_blocked",
      requestId: "te_merchant_block",
    });
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    expect(result.decision.verdict).toBe("BLOCK");
    expect(result.response.responseCode).toBe("RESTRICTED_MERCHANT");
  });

  it("blocks an expired mandate", async () => {
    const request = highnoteRequest({ paymentCardId: "card_expired_001", requestId: "te_expired" });
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    expect(result.decision.reason_codes).toContain("POLICY_EXPIRED");
    expect(result.response.responseCode).toBe("INVALID_TRANSACTION");
  });

  it("declines the current attempt when human approval is required", async () => {
    const request = highnoteRequest({
      paymentCardId: "card_approval_001",
      requestId: "te_approval",
    });
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    expect(result.decision.verdict).toBe("REQUIRE_APPROVAL");
    expect(result.response.responseCode).toBe("INVALID_TRANSACTION");
  });

  it("accepts the documented Highnote Test simulator identity shape", async () => {
    const request = highnoteRequest({
      paymentCardId: "card_simulator_001",
      requestId: "te_simulator",
      transactionId: "tx_simulator",
      merchantId: null,
      merchantName: "HIGHNOTE_PLATFORM",
      merchantCategoryCode: null,
      merchantCategory: "GENERAL_SERVICES",
      preliminaryResponseCode: null,
    });
    delete request.data.collaborativeAuthorizationRequest.merchantDetails.categoryCode;
    delete request.data.collaborativeAuthorizationRequest.additionalNetworkData;
    const { rawBody, signature } = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    expect(result.decision.verdict).toBe("ALLOW");
    expect(result.bundle.action.transaction.payee).toBe("name:HIGHNOTE_PLATFORM");
    expect(result.response.responseCode).toBe("APPROVED");
  });

  it("fails closed when the merchant identity is absent", async () => {
    const request = highnoteRequest({
      merchantId: null,
      merchantName: null,
      merchantCategoryCode: null,
      merchantCategory: null,
      requestId: "te_missing_merchant",
    });
    const { rawBody, signature } = signedBody(request);
    await expect(
      (await testProcessor()).process({ request, rawBody, highnoteSignature: signature }),
    ).rejects.toMatchObject({ code: "MISSING_MANDATE_IDENTITY" });
  });

  it("blocks wrong agent and policy version bindings", async () => {
    const store = await testMandateStore();
    const mandate = store.findByPaymentCardId("card_allow_001");
    expect(mandate).toBeDefined();
    const request = highnoteRequest();
    const { rawBody } = signedBody(request);
    const action = actionFromHighnote({
      request,
      rawBody,
      mandate: mandate!,
      resource: "https://adapter.example.test/v1/highnote/collaborative-authorization",
    });
    expect(
      evaluateMandate({
        action: { ...action, agent_id: "wrong-agent" },
        mandate: mandate!,
        requestedAmountMinor: 5000,
        at: FIXED_NOW,
      }).reasonCodes,
    ).toContain("KYA_AGENT_IDENTITY_MISMATCH");
    expect(
      evaluateMandate({
        action,
        mandate: mandate!,
        requestedAmountMinor: 5000,
        at: FIXED_NOW,
        expectedPolicyVersion: "2",
      }).reasonCodes,
    ).toContain("POLICY_VERSION_MISMATCH");
  });
});
