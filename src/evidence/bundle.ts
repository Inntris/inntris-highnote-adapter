import {
  buildKeyRegistryEntry,
  canonicalBytes,
  hashCanonical,
  KeyRegistrySchema,
  publicKeyFingerprint,
  verifyDecision,
  verifyEd25519Signature,
  type InntrisActionV1,
  type InntrisDecisionV1,
  type KeyRegistry,
  type SigningProvider,
} from "../contracts/index.js";
import type { CollaborativeAuthorizationResponse } from "../highnote/index.js";
import { InntrisEvidenceBundleV1Schema, type InntrisEvidenceBundleV1 } from "./schemas.js";

type UnsignedBundle = Omit<InntrisEvidenceBundleV1, "integrity"> & {
  integrity: Omit<InntrisEvidenceBundleV1["integrity"], "signature">;
};

export function bundleIntegrityPayload(bundle: InntrisEvidenceBundleV1): UnsignedBundle {
  const { signature: ignoredSignature, ...integrity } = bundle.integrity;
  void ignoredSignature;
  return { ...bundle, integrity };
}

export async function createEvidenceBundle(input: {
  bundleId: string;
  action: InntrisActionV1;
  decision: InntrisDecisionV1;
  response: CollaborativeAuthorizationResponse;
  sourcePayloadHash: `sha256:${string}`;
  signer: SigningProvider;
  keyRegistry?: KeyRegistry;
}): Promise<InntrisEvidenceBundleV1> {
  if (input.action.rail !== "card") {
    throw new TypeError("Highnote evidence requires a card action");
  }
  const requestId = input.action.protocol_reference.authorisation_request_id;
  const transactionIdValue = input.action.extensions?.["highnote_transaction_id"];
  const transactionId = typeof transactionIdValue === "string" ? transactionIdValue : "";
  if (transactionId.length === 0) {
    throw new TypeError("Highnote evidence requires a card action with a transaction reference");
  }
  const keyRegistry = KeyRegistrySchema.parse(
    input.keyRegistry ?? {
      version: "inntris-key-registry-v1",
      keys: [
        buildKeyRegistryEntry(input.signer, {
          notBefore: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
    },
  );
  const unsigned: UnsignedBundle = {
    version: "inntris-evidence-bundle-v1",
    compatibility_status: "proposed-until-upstream-adoption",
    bundle_id: input.bundleId,
    action: input.action,
    decision: input.decision,
    execution_reference: {
      rail: "card",
      provider: "highnote",
      collaborative_authorization_request_id: requestId,
      transaction_id: transactionId,
      response_code: input.response.responseCode,
      authorized_amount: input.response.authorizedAmount ?? null,
      attestation_class: "reported",
    },
    source_observation: {
      payload_hash: input.sourcePayloadHash,
      request_signature_verified: true,
      request_freshness_verified: true,
      attestation_class: "observed",
    },
    attestations: [
      {
        subject: "inntris_organisational_authority_decision",
        attestation_class: "self",
        statement_hash: hashCanonical(input.decision),
      },
      {
        subject: "highnote_authorization_request_as_reported",
        attestation_class: "reported",
        statement_hash: input.sourcePayloadHash,
      },
      {
        subject: "captured_payload_integrity",
        attestation_class: "self",
        statement_hash: hashCanonical({ payload_hash: input.sourcePayloadHash }),
      },
    ],
    verification_material: { key_registry: keyRegistry },
    integrity: {
      alg: input.signer.algorithm,
      key_id: input.signer.keyId,
      public_key: Buffer.from(input.signer.publicKey).toString("base64url"),
    },
  };
  const signature = await input.signer.sign(canonicalBytes(unsigned));
  return InntrisEvidenceBundleV1Schema.parse({
    ...unsigned,
    integrity: { ...unsigned.integrity, signature },
  });
}

export interface EvidenceVerificationResult {
  valid: boolean;
  checks: {
    schema: boolean;
    bundle_signature: boolean;
    key_registry: boolean;
    decision: boolean;
    highnote_binding: boolean;
    source_payload_binding: boolean;
  };
  decision_verdict?: string;
  trust_summary: {
    inntris_decision: "cryptographically verified" | "not verified";
    captured_payload_integrity: "cryptographically verified" | "not verified";
    highnote_transaction_fact: "reported by Highnote, not independently proven";
  };
}

export function verifyEvidenceBundle(
  input: unknown,
  options: { at: Date; expectedPolicyVersion?: string },
): EvidenceVerificationResult {
  const checks = {
    schema: false,
    bundle_signature: false,
    key_registry: false,
    decision: false,
    highnote_binding: false,
    source_payload_binding: false,
  };
  const failure = (): EvidenceVerificationResult => ({
    valid: false,
    checks,
    trust_summary: {
      inntris_decision: "not verified",
      captured_payload_integrity: "not verified",
      highnote_transaction_fact: "reported by Highnote, not independently proven",
    },
  });
  const parsed = InntrisEvidenceBundleV1Schema.safeParse(input);
  if (!parsed.success) return failure();
  checks.schema = true;
  const bundle = parsed.data;
  const publicKey = Buffer.from(bundle.integrity.public_key, "base64url");
  checks.bundle_signature = verifyEd25519Signature(
    canonicalBytes(bundleIntegrityPayload(bundle)),
    bundle.integrity.signature,
    publicKey,
  );
  const registryKey = bundle.verification_material.key_registry.keys.find(
    (key) => key.key_id === bundle.integrity.key_id,
  );
  checks.key_registry =
    registryKey !== undefined &&
    registryKey.public_key === bundle.integrity.public_key &&
    registryKey.fingerprint === publicKeyFingerprint(publicKey) &&
    registryKey.status !== "revoked";
  const decisionVerification = verifyDecision({
    decision: bundle.decision,
    action: bundle.action,
    keyRegistry: bundle.verification_material.key_registry,
    at: options.at,
    ...(options.expectedPolicyVersion === undefined
      ? {}
      : { expectedPolicyVersion: options.expectedPolicyVersion }),
  });
  checks.decision = decisionVerification.valid;

  const actionRequestId =
    bundle.action.rail === "card"
      ? bundle.action.protocol_reference.authorisation_request_id
      : undefined;
  checks.highnote_binding =
    bundle.action.rail === "card" &&
    bundle.execution_reference.collaborative_authorization_request_id === actionRequestId &&
    bundle.execution_reference.transaction_id ===
      bundle.action.extensions?.["highnote_transaction_id"];
  checks.source_payload_binding =
    bundle.source_observation.payload_hash ===
    bundle.action.extensions?.["highnote_source_payload_hash"];
  const valid = Object.values(checks).every(Boolean);
  return {
    valid,
    checks,
    decision_verdict: bundle.decision.verdict,
    trust_summary: {
      inntris_decision: valid ? "cryptographically verified" : "not verified",
      captured_payload_integrity: valid ? "cryptographically verified" : "not verified",
      highnote_transaction_fact: "reported by Highnote, not independently proven",
    },
  };
}
