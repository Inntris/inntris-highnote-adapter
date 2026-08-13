import { describe, expect, it } from "vitest";

import { composeAuthorisation, outcomeFromResponse } from "../src/adapter/index.js";
import { AdapterError } from "../src/errors.js";

const requestedAmount = { value: 5000, currencyCode: "USD" } as const;
const allow = { allowed: true, responseCode: "APPROVED" } as const;
const block = { allowed: false, responseCode: "RESTRICTED_MERCHANT" } as const;

describe("deny preserving pass through composition", () => {
  it("allows only when both decisions allow", () => {
    expect(
      composeAuthorisation({
        transactionId: "tx_1",
        requestedAmount,
        terminalSupportsPartialApproval: true,
        inntris: allow,
        downstream: allow,
      }).responseCode,
    ).toBe("APPROVED");
  });

  it("lets an Inntris block win", () => {
    expect(
      composeAuthorisation({
        transactionId: "tx_1",
        requestedAmount,
        terminalSupportsPartialApproval: true,
        inntris: block,
        downstream: allow,
      }).responseCode,
    ).toBe("RESTRICTED_MERCHANT");
  });

  it("lets a downstream block win", () => {
    expect(
      composeAuthorisation({
        transactionId: "tx_1",
        requestedAmount,
        terminalSupportsPartialApproval: true,
        inntris: allow,
        downstream: block,
      }).responseCode,
    ).toBe("RESTRICTED_MERCHANT");
  });

  it("uses the lower authorised amount", () => {
    const response = composeAuthorisation({
      transactionId: "tx_1",
      requestedAmount,
      terminalSupportsPartialApproval: true,
      inntris: { ...allow, authorizedAmount: { value: 4500, currencyCode: "USD" } },
      downstream: { ...allow, authorizedAmount: { value: 4000, currencyCode: "USD" } },
    });
    expect(response).toMatchObject({
      responseCode: "PARTIAL_AMOUNT_APPROVED",
      authorizedAmount: { value: 4000, currencyCode: "USD" },
    });
  });

  it("declines a partial amount when the terminal cannot support it", () => {
    const response = composeAuthorisation({
      transactionId: "tx_1",
      requestedAmount,
      terminalSupportsPartialApproval: false,
      inntris: { ...allow, authorizedAmount: { value: 4000, currencyCode: "USD" } },
    });
    expect(response.responseCode).toBe("INVALID_TRANSACTION");
  });

  it("rejects a downstream partial approval that supplies no ceiling", () => {
    try {
      outcomeFromResponse(
        { transaction: { id: "tx_1" }, responseCode: "PARTIAL_AMOUNT_APPROVED" },
        "tx_1",
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ code: "DOWNSTREAM_PARTIAL_WITHOUT_AMOUNT" });
      return;
    }
    throw new Error("Expected a partial approval without an amount to be rejected");
  });

  it("rejects a malformed or mismatched downstream response", () => {
    expect(() => outcomeFromResponse({ responseCode: "APPROVED" }, "tx_1")).toThrow();
    try {
      outcomeFromResponse({ transaction: { id: "tx_2" }, responseCode: "APPROVED" }, "tx_1");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ code: "DOWNSTREAM_TRANSACTION_MISMATCH" });
      return;
    }
    throw new Error("Expected downstream transaction mismatch");
  });
});
