import { createHmac, timingSafeEqual } from "node:crypto";

import { AdapterError } from "../errors.js";

export type SignatureEncoding = "hex" | "base64" | "base64url";

function decodeSignature(value: string, encoding: SignatureEncoding): Buffer {
  if (encoding === "hex" && !/^[0-9a-fA-F]{64}$/u.test(value)) {
    throw new AdapterError("INVALID_SIGNATURE_FORMAT", "Invalid Highnote signature format", 401);
  }
  if (encoding === "base64" && !/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    throw new AdapterError("INVALID_SIGNATURE_FORMAT", "Invalid Highnote signature format", 401);
  }
  if (encoding === "base64url" && !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new AdapterError("INVALID_SIGNATURE_FORMAT", "Invalid Highnote signature format", 401);
  }
  try {
    const decoded = Buffer.from(value, encoding);
    if (decoded.byteLength !== 32) {
      throw new AdapterError("INVALID_SIGNATURE_FORMAT", "Invalid Highnote signature length", 401);
    }
    return decoded;
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("INVALID_SIGNATURE_FORMAT", "Invalid Highnote signature format", 401);
  }
}

export function createHighnoteSignature(
  rawBody: Uint8Array,
  secret: string,
  encoding: SignatureEncoding,
): string {
  return createHmac("sha256", secret).update(rawBody).digest(encoding);
}

export function verifyHighnoteAuthenticity(input: {
  rawBody: Uint8Array;
  signatureHeader: string | undefined;
  signingSecrets: readonly string[];
  signatureEncoding: SignatureEncoding;
}): void {
  if (input.signatureHeader === undefined || input.signatureHeader.length === 0) {
    throw new AdapterError("MISSING_SIGNATURE", "Missing Highnote signature", 401);
  }
  if (input.signingSecrets.length === 0) {
    throw new AdapterError("AUTHENTICITY_UNAVAILABLE", "No Highnote signing key configured", 503);
  }
  const received = decodeSignature(input.signatureHeader, input.signatureEncoding);
  let valid = false;
  for (const secret of input.signingSecrets) {
    const expected = createHmac("sha256", secret).update(input.rawBody).digest();
    valid = timingSafeEqual(received, expected) || valid;
  }
  if (!valid) {
    throw new AdapterError("INVALID_SIGNATURE", "Highnote signature verification failed", 401);
  }
}

export function verifyHighnoteFreshness(input: {
  signatureTimestamp: number;
  now: Date;
  maxAgeMs: number;
  maxFutureSkewMs: number;
}): void {
  const age = input.now.getTime() - input.signatureTimestamp;
  if (age > input.maxAgeMs) {
    throw new AdapterError("STALE_REQUEST", "Highnote request signature is stale", 401);
  }
  if (age < -input.maxFutureSkewMs) {
    throw new AdapterError(
      "FUTURE_SIGNATURE_TIMESTAMP",
      "Highnote request signature timestamp is too far in the future",
      401,
    );
  }
}
