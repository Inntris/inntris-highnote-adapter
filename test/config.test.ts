import { createHash } from "node:crypto";

import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    HIGHNOTE_SIGNING_SECRETS: "current-secret,previous-secret",
    HIGHNOTE_SIGNATURE_ENCODING: "hex",
    INNTRIS_SIGNING_KEY_ID: "test-key",
    INNTRIS_SIGNING_SEED_BASE64URL: "fixture-seed",
    MANDATE_SNAPSHOT_PATH: "./config/mandates.test.json",
    PUBLIC_ADAPTER_URL: "https://adapter.example.test/v1/highnote/collaborative-authorization",
    ...overrides,
  };
}

function coreEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const seed = Buffer.alloc(32, 9);
  const fingerprint = createHash("sha256")
    .update(nacl.sign.keyPair.fromSeed(seed).publicKey)
    .digest("hex");
  return {
    NODE_ENV: "production",
    AUTHORITY_MODE: "inntris_core",
    HIGHNOTE_SIGNING_SECRETS: "current-secret,previous-secret",
    HIGHNOTE_SIGNATURE_ENCODING: "hex",
    PUBLIC_ADAPTER_URL: "https://adapter.example.test/v1/highnote/collaborative-authorization",
    INNTRIS_API_URL: "https://api.inntris.com",
    INNTRIS_AGENT_ID: "2836f6c7-ba2b-4b36-801d-0f1a0f84982e",
    INNTRIS_PRIVATE_KEY_B64: seed.toString("base64"),
    INNTRIS_PUBLIC_KEY_FINGERPRINT: fingerprint,
    HIGHNOTE_CARD_ID: "cd_test_card",
    INNTRIS_TIMEOUT_MS: "1200",
    ...overrides,
  };
}

describe("runtime configuration", () => {
  it("loads explicit production-safe configuration", () => {
    const config = loadConfig(
      validEnvironment({
        DOWNSTREAM_AUTHORIZATION_URL: "https://customer.example.test/authorize",
        DOWNSTREAM_TIMEOUT_MS: "500",
      }),
    );
    if (config.authorityMode !== "local") throw new Error("Expected local mode");
    expect(config.nodeEnv).toBe("production");
    expect(config.highnoteSigningSecrets).toEqual(["current-secret", "previous-secret"]);
    expect(config.downstreamUrl?.protocol).toBe("https:");
    expect(config.downstreamTimeoutMs).toBe(500);
  });

  it("defaults to declining after an authenticated request fails", () => {
    expect(loadConfig(validEnvironment()).authorizationFailurePolicy).toBe("decline");
    expect(
      loadConfig(validEnvironment({ AUTHORIZATION_FAILURE_POLICY: "stand_in" }))
        .authorizationFailurePolicy,
    ).toBe("stand_in");
    expect(() =>
      loadConfig(validEnvironment({ AUTHORIZATION_FAILURE_POLICY: "approve" })),
    ).toThrow();
  });

  it("rejects non-HTTPS production endpoints", () => {
    expect(() =>
      loadConfig(validEnvironment({ PUBLIC_ADAPTER_URL: "http://adapter.example.test" })),
    ).toThrow("PUBLIC_ADAPTER_URL must use HTTPS");
    expect(() =>
      loadConfig(
        validEnvironment({ DOWNSTREAM_AUTHORIZATION_URL: "http://customer.example.test" }),
      ),
    ).toThrow("DOWNSTREAM_AUTHORIZATION_URL must use HTTPS");
  });

  it("rejects missing secrets and invalid numeric settings", () => {
    expect(() => loadConfig(validEnvironment({ HIGHNOTE_SIGNING_SECRETS: "" }))).toThrow(
      "HIGHNOTE_SIGNING_SECRETS is required",
    );
    expect(() => loadConfig(validEnvironment({ PORT: "0" }))).toThrow("Expected positive integer");
  });

  it("loads Core authority mode without local signer or mandate configuration", () => {
    const config = loadConfig(coreEnvironment());
    expect(config.authorityMode).toBe("inntris_core");
    if (config.authorityMode !== "inntris_core") throw new Error("Expected Core mode");
    expect(config.inntrisApiUrl.toString()).toBe("https://api.inntris.com/");
    expect(config.inntrisTimeoutMs).toBe(1200);
    expect(config.authorizationFailurePolicy).toBe("decline");
  });

  it("fails closed when the Core seed does not match the expected fingerprint", () => {
    expect(() =>
      loadConfig(coreEnvironment({ INNTRIS_PUBLIC_KEY_FINGERPRINT: "0".repeat(64) })),
    ).toThrow("does not match");
  });

  it("forbids stand-in, downstream fallback and an over-budget timeout in Core mode", () => {
    expect(() => loadConfig(coreEnvironment({ AUTHORIZATION_FAILURE_POLICY: "stand_in" }))).toThrow(
      "must be decline",
    );
    expect(() =>
      loadConfig(
        coreEnvironment({ DOWNSTREAM_AUTHORIZATION_URL: "https://customer.example.test" }),
      ),
    ).toThrow("not allowed");
    expect(() => loadConfig(coreEnvironment({ INNTRIS_TIMEOUT_MS: "2000" }))).toThrow(
      "must be less",
    );
  });
});
