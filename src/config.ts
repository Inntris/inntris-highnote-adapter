import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

import nacl from "tweetnacl";
import { z } from "zod";

import type { DownstreamFailurePolicy } from "./adapter/downstream.js";
import type { AuthorizationFailurePolicy } from "./errors.js";
import type { SignatureEncoding } from "./highnote/index.js";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("Expected positive integer");
  }
  return parsed;
}

function productionSafeUrl(value: string, name: string, nodeEnv: AppConfig["nodeEnv"]): URL {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(`${name} must not contain credentials`);
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new TypeError(`${name} must use HTTPS in production`);
  }
  return url;
}

function standardBase64Seed(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError("INNTRIS_PRIVATE_KEY_B64 must be canonical standard base64");
  }
  const seed = Buffer.from(value, "base64");
  if (seed.byteLength !== nacl.sign.seedLength || seed.toString("base64") !== value) {
    throw new TypeError(
      `INNTRIS_PRIVATE_KEY_B64 must encode exactly ${nacl.sign.seedLength} bytes`,
    );
  }
  return seed;
}

function verifyExpectedFingerprint(seed: Uint8Array, expected: string): void {
  const parsed = z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(expected);
  const publicKey = nacl.sign.keyPair.fromSeed(seed).publicKey;
  const actual = createHash("sha256").update(publicKey).digest();
  const configured = Buffer.from(parsed, "hex");
  if (!timingSafeEqual(actual, configured)) {
    throw new TypeError("INNTRIS_PRIVATE_KEY_B64 does not match INNTRIS_PUBLIC_KEY_FINGERPRINT");
  }
}

interface CommonConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  highnoteSigningSecrets: string[];
  signatureEncoding: SignatureEncoding;
  maxSignatureAgeMs: number;
  maxFutureSkewMs: number;
  publicAdapterUrl: string;
  evidenceOutputDirectory: string;
  idempotencyMaxEntries: number;
  idempotencyTtlMs: number;
  authorizationFailurePolicy: AuthorizationFailurePolicy;
}

export interface LocalAuthorityConfig extends CommonConfig {
  authorityMode: "local";
  signingKeyId: string;
  signingSeedBase64Url: string;
  mandateSnapshotPath: string;
  downstreamUrl?: URL;
  downstreamTimeoutMs: number;
  downstreamFailurePolicy: DownstreamFailurePolicy;
}

export interface InntrisCoreAuthorityConfig extends CommonConfig {
  authorityMode: "inntris_core";
  inntrisApiUrl: URL;
  inntrisAgentId: string;
  inntrisPrivateKeyBase64: string;
  inntrisPublicKeyFingerprint: string;
  highnoteCardId: string;
  inntrisTimeoutMs: number;
  inntrisReceiptBaseUrl: URL;
}

export type AppConfig = LocalAuthorityConfig | InntrisCoreAuthorityConfig;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = z
    .enum(["development", "test", "production"])
    .parse(env["NODE_ENV"] ?? "development");
  const authorityMode = z.enum(["local", "inntris_core"]).parse(env["AUTHORITY_MODE"] ?? "local");
  const signatureEncoding = z
    .enum(["hex", "base64", "base64url"])
    .parse(env["HIGHNOTE_SIGNATURE_ENCODING"] ?? "hex");
  const authorizationFailurePolicy = z
    .enum(["decline", "stand_in"])
    .parse(env["AUTHORIZATION_FAILURE_POLICY"] ?? "decline");
  const publicAdapterUrl = required(env, "PUBLIC_ADAPTER_URL");
  productionSafeUrl(publicAdapterUrl, "PUBLIC_ADAPTER_URL", nodeEnv);

  const common: CommonConfig = {
    nodeEnv,
    host: env["HOST"] ?? "0.0.0.0",
    port: positiveInteger(env["PORT"], 8080),
    logLevel: env["LOG_LEVEL"] ?? "info",
    highnoteSigningSecrets: required(env, "HIGHNOTE_SIGNING_SECRETS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    signatureEncoding,
    maxSignatureAgeMs: positiveInteger(env["HIGHNOTE_MAX_SIGNATURE_AGE_MS"], 300_000),
    maxFutureSkewMs: positiveInteger(env["HIGHNOTE_MAX_FUTURE_SKEW_MS"], 30_000),
    publicAdapterUrl,
    evidenceOutputDirectory: path.resolve(env["EVIDENCE_OUTPUT_DIRECTORY"] ?? "./evidence-output"),
    idempotencyMaxEntries: positiveInteger(env["IDEMPOTENCY_MAX_ENTRIES"], 10_000),
    idempotencyTtlMs: positiveInteger(env["IDEMPOTENCY_TTL_MS"], 600_000),
    authorizationFailurePolicy,
  };

  if (authorityMode === "inntris_core") {
    if (authorizationFailurePolicy !== "decline") {
      throw new TypeError("AUTHORIZATION_FAILURE_POLICY must be decline in inntris_core mode");
    }
    if (env["DOWNSTREAM_AUTHORIZATION_URL"]?.trim()) {
      throw new TypeError("DOWNSTREAM_AUTHORIZATION_URL is not allowed in inntris_core mode");
    }
    const inntrisPrivateKeyBase64 = required(env, "INNTRIS_PRIVATE_KEY_B64");
    const inntrisPublicKeyFingerprint = required(env, "INNTRIS_PUBLIC_KEY_FINGERPRINT");
    const seed = standardBase64Seed(inntrisPrivateKeyBase64);
    try {
      verifyExpectedFingerprint(seed, inntrisPublicKeyFingerprint);
    } finally {
      seed.fill(0);
    }
    const inntrisTimeoutMs = positiveInteger(env["INNTRIS_TIMEOUT_MS"], 1_200);
    if (inntrisTimeoutMs >= 2_000) {
      throw new TypeError(
        "INNTRIS_TIMEOUT_MS must be less than Highnote's 2000 ms callback budget",
      );
    }
    return {
      ...common,
      authorityMode,
      inntrisApiUrl: productionSafeUrl(
        required(env, "INNTRIS_API_URL"),
        "INNTRIS_API_URL",
        nodeEnv,
      ),
      inntrisAgentId: z.uuid().parse(required(env, "INNTRIS_AGENT_ID")),
      inntrisPrivateKeyBase64,
      inntrisPublicKeyFingerprint,
      highnoteCardId: z.string().min(1).max(128).parse(required(env, "HIGHNOTE_CARD_ID")),
      inntrisTimeoutMs,
      inntrisReceiptBaseUrl: productionSafeUrl(
        env["INNTRIS_RECEIPT_BASE_URL"]?.trim() || "https://www.inntris.com/verify/",
        "INNTRIS_RECEIPT_BASE_URL",
        nodeEnv,
      ),
    };
  }

  const downstreamFailurePolicy = z
    .enum(["deny", "allow_inntris"])
    .parse(env["DOWNSTREAM_FAILURE_POLICY"] ?? "deny");
  const downstreamValue = env["DOWNSTREAM_AUTHORIZATION_URL"]?.trim();
  const downstreamUrl =
    downstreamValue === undefined || downstreamValue === ""
      ? undefined
      : productionSafeUrl(downstreamValue, "DOWNSTREAM_AUTHORIZATION_URL", nodeEnv);
  return {
    ...common,
    authorityMode,
    signingKeyId: required(env, "INNTRIS_SIGNING_KEY_ID"),
    signingSeedBase64Url: required(env, "INNTRIS_SIGNING_SEED_BASE64URL"),
    mandateSnapshotPath: path.resolve(required(env, "MANDATE_SNAPSHOT_PATH")),
    ...(downstreamUrl === undefined ? {} : { downstreamUrl }),
    downstreamTimeoutMs: positiveInteger(env["DOWNSTREAM_TIMEOUT_MS"], 650),
    downstreamFailurePolicy,
  };
}
