import { describe, expect, it } from "vitest";

import {
  createHighnoteSignature,
  verifyHighnoteAuthenticity,
  verifyHighnoteFreshness,
} from "../src/highnote/index.js";
import { AdapterError } from "../src/errors.js";
import { FIXED_NOW, HIGHNOTE_SECRET } from "./helpers.js";

function expectAdapterError(action: () => void, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected AdapterError ${code}`);
}

describe("Highnote request authentication", () => {
  const body = Buffer.from('{"test":true}', "utf8");

  it("accepts a valid HMAC SHA 256 signature", () => {
    expect(() =>
      verifyHighnoteAuthenticity({
        rawBody: body,
        signatureHeader: createHighnoteSignature(body, HIGHNOTE_SECRET, "hex"),
        signingSecrets: [HIGHNOTE_SECRET],
        signatureEncoding: "hex",
      }),
    ).not.toThrow();
  });

  it("supports explicit base64 encoding", () => {
    expect(() =>
      verifyHighnoteAuthenticity({
        rawBody: body,
        signatureHeader: createHighnoteSignature(body, HIGHNOTE_SECRET, "base64"),
        signingSecrets: [HIGHNOTE_SECRET],
        signatureEncoding: "base64",
      }),
    ).not.toThrow();
  });

  it("accepts a previous signing key during rotation", () => {
    expect(() =>
      verifyHighnoteAuthenticity({
        rawBody: body,
        signatureHeader: createHighnoteSignature(body, "previous-key", "hex"),
        signingSecrets: [HIGHNOTE_SECRET, "previous-key"],
        signatureEncoding: "hex",
      }),
    ).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    expectAdapterError(
      () =>
        verifyHighnoteAuthenticity({
          rawBody: body,
          signatureHeader: "00".repeat(32),
          signingSecrets: [HIGHNOTE_SECRET],
          signatureEncoding: "hex",
        }),
      "INVALID_SIGNATURE",
    );
  });

  it("rejects stale requests", () => {
    expectAdapterError(
      () =>
        verifyHighnoteFreshness({
          signatureTimestamp: FIXED_NOW.getTime() - 300_001,
          now: FIXED_NOW,
          maxAgeMs: 300_000,
          maxFutureSkewMs: 30_000,
        }),
      "STALE_REQUEST",
    );
  });

  it("rejects timestamps too far in the future", () => {
    expectAdapterError(
      () =>
        verifyHighnoteFreshness({
          signatureTimestamp: FIXED_NOW.getTime() + 30_001,
          now: FIXED_NOW,
          maxAgeMs: 300_000,
          maxFutureSkewMs: 30_000,
        }),
      "FUTURE_SIGNATURE_TIMESTAMP",
    );
  });
});
