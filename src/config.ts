import path from "node:path";

import { z } from "zod";

import type { SignatureEncoding } from "./highnote/index.js";
import type { DownstreamFailurePolicy } from "./adapter/downstream.js";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new TypeError("Expected positive integer");
  return parsed;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  highnoteSigningSecrets: string[];
  signatureEncoding: SignatureEncoding;
  maxSignatureAgeMs: number;
  maxFutureSkewMs: number;
  signingKeyId: string;
  signingSeedBase64Url: string;
  mandateSnapshotPath: string;
  publicAdapterUrl: string;
  evidenceOutputDirectory: string;
  idempotencyMaxEntries: number;
  idempotencyTtlMs: number;
  downstreamUrl?: URL;
  downstreamTimeoutMs: number;
  downstreamFailurePolicy: DownstreamFailurePolicy;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = z
    .enum(["development", "test", "production"])
    .parse(env["NODE_ENV"] ?? "development");
  const signatureEncoding = z
    .enum(["hex", "base64", "base64url"])
    .parse(env["HIGHNOTE_SIGNATURE_ENCODING"] ?? "hex");
  const downstreamFailurePolicy = z
    .enum(["deny", "allow_inntris"])
    .parse(env["DOWNSTREAM_FAILURE_POLICY"] ?? "deny");
  const downstreamValue = env["DOWNSTREAM_AUTHORIZATION_URL"]?.trim();
  const downstreamUrl =
    downstreamValue === undefined || downstreamValue === "" ? undefined : new URL(downstreamValue);
  if (
    nodeEnv === "production" &&
    downstreamUrl !== undefined &&
    downstreamUrl.protocol !== "https:"
  ) {
    throw new TypeError("DOWNSTREAM_AUTHORIZATION_URL must use HTTPS in production");
  }
  const publicAdapterUrl = required(env, "PUBLIC_ADAPTER_URL");
  if (nodeEnv === "production" && new URL(publicAdapterUrl).protocol !== "https:") {
    throw new TypeError("PUBLIC_ADAPTER_URL must use HTTPS in production");
  }
  return {
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
    signingKeyId: required(env, "INNTRIS_SIGNING_KEY_ID"),
    signingSeedBase64Url: required(env, "INNTRIS_SIGNING_SEED_BASE64URL"),
    mandateSnapshotPath: path.resolve(required(env, "MANDATE_SNAPSHOT_PATH")),
    publicAdapterUrl,
    evidenceOutputDirectory: path.resolve(env["EVIDENCE_OUTPUT_DIRECTORY"] ?? "./evidence-output"),
    idempotencyMaxEntries: positiveInteger(env["IDEMPOTENCY_MAX_ENTRIES"], 10_000),
    idempotencyTtlMs: positiveInteger(env["IDEMPOTENCY_TTL_MS"], 600_000),
    ...(downstreamUrl === undefined ? {} : { downstreamUrl }),
    downstreamTimeoutMs: positiveInteger(env["DOWNSTREAM_TIMEOUT_MS"], 650),
    downstreamFailurePolicy,
  };
}
