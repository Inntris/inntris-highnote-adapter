import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { InntrisActionV1Schema, verifyDecision } from "../src/contracts/index.js";
import { FIXED_NOW, highnoteRequest, signedBody, testProcessor } from "./helpers.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/x402/upstream/${name}.json`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("cross rail decision verification", () => {
  it("accepts the pinned upstream x402 golden decision", async () => {
    const result = verifyDecision({
      action: await fixture("action"),
      decision: await fixture("decision"),
      keyRegistry: await fixture("key-registry"),
      at: new Date("2026-07-29T09:30:30.000Z"),
      expectedPolicyVersion: "1",
    });
    expect(result.valid).toBe(true);
    expect(result.verdict).toBe("ALLOW");
  });

  it("accepts a Highnote card decision through the same verifier", async () => {
    const request = highnoteRequest();
    const { rawBody, signature } = signedBody(request);
    const processed = await (
      await testProcessor()
    ).process({
      request,
      rawBody,
      highnoteSignature: signature,
    });
    const result = verifyDecision({
      action: processed.bundle.action,
      decision: processed.decision,
      keyRegistry: processed.bundle.verification_material.key_registry,
      at: FIXED_NOW,
      expectedPolicyVersion: "1",
    });
    expect(result.valid).toBe(true);
    expect(processed.bundle.action.rail).toBe("card");
  });

  it("rejects an exact action mutation on both rails", async () => {
    const x402Action = structuredClone(InntrisActionV1Schema.parse(await fixture("action")));
    x402Action.transaction.amount = "4.60";
    const x402 = verifyDecision({
      action: x402Action,
      decision: await fixture("decision"),
      keyRegistry: await fixture("key-registry"),
      at: new Date("2026-07-29T09:30:30.000Z"),
    });
    expect(x402.reason_codes).toContain("ACTION_HASH_MISMATCH");

    const request = highnoteRequest();
    const { rawBody, signature } = signedBody(request);
    const processed = await (
      await testProcessor()
    ).process({ request, rawBody, highnoteSignature: signature });
    const cardAction = structuredClone(processed.bundle.action);
    cardAction.transaction.payee = "merchant_changed";
    const card = verifyDecision({
      action: cardAction,
      decision: processed.decision,
      keyRegistry: processed.bundle.verification_material.key_registry,
      at: FIXED_NOW,
    });
    expect(card.reason_codes).toContain("ACTION_HASH_MISMATCH");
  });
});
