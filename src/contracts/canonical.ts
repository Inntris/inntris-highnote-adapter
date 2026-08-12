import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

import { InntrisActionV1Schema, type InntrisActionV1 } from "./schemas.js";

export function canonicalise(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TypeError("Value cannot be represented by RFC 8785 JCS");
  }
  return result;
}

export function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalise(value), "utf8");
}

export function sha256Bytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value: unknown): `sha256:${string}` {
  return sha256Bytes(canonicalBytes(value));
}

export function hashAction(input: InntrisActionV1): `sha256:${string}` {
  return hashCanonical(InntrisActionV1Schema.parse(input));
}

export function hashPolicyObject(validatedPolicy: unknown): `sha256:${string}` {
  return hashCanonical(validatedPolicy);
}
