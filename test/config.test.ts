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

describe("runtime configuration", () => {
  it("loads explicit production-safe configuration", () => {
    const config = loadConfig(
      validEnvironment({
        DOWNSTREAM_AUTHORIZATION_URL: "https://customer.example.test/authorize",
        DOWNSTREAM_TIMEOUT_MS: "500",
      }),
    );
    expect(config.nodeEnv).toBe("production");
    expect(config.highnoteSigningSecrets).toEqual(["current-secret", "previous-secret"]);
    expect(config.downstreamUrl?.protocol).toBe("https:");
    expect(config.downstreamTimeoutMs).toBe(500);
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
});
