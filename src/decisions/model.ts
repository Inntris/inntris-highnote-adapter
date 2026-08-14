import {
  verifyEvidenceBundle,
  type EvidenceVerificationResult,
  type InntrisEvidenceBundleV1,
} from "../evidence/index.js";

export interface DecisionSummary {
  decision_id: string;
  verdict: InntrisEvidenceBundleV1["decision"]["verdict"];
  reason_codes: InntrisEvidenceBundleV1["decision"]["reason_codes"];
  action_hash: string;
  amount: string;
  currency: string;
  merchant: string;
  merchant_category: string;
  mandate_id: string;
  policy_version: string;
  highnote_request_id: string;
  highnote_transaction_id: string;
  highnote_response_code: InntrisEvidenceBundleV1["execution_reference"]["response_code"];
  created_at: string;
  signature_verified: boolean;
  freshness_verified: boolean;
  evidence_bundle_id: string;
}

export interface DecisionDetail extends DecisionSummary {
  evidence_integrity: "VERIFIED" | "INVALID";
  evidence_checks: EvidenceVerificationResult["checks"];
  decision: InntrisEvidenceBundleV1["decision"];
  action: InntrisEvidenceBundleV1["action"];
  execution_reference: InntrisEvidenceBundleV1["execution_reference"];
  source_observation: InntrisEvidenceBundleV1["source_observation"];
  integrity_metadata: InntrisEvidenceBundleV1["integrity"];
  verification_material: InntrisEvidenceBundleV1["verification_material"];
}

function extensionString(bundle: InntrisEvidenceBundleV1, key: string): string {
  const value = bundle.action.extensions?.[key];
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function merchant(bundle: InntrisEvidenceBundleV1): string {
  const payee = bundle.action.transaction.payee;
  return bundle.action.extensions?.["merchant_identity_source"] === "name" &&
    payee.startsWith("name:")
    ? payee.slice(5)
    : payee;
}

function merchantCategory(bundle: InntrisEvidenceBundleV1): string {
  const reference = extensionString(bundle, "merchant_category_reference");
  return bundle.action.extensions?.["merchant_category_source"] === "category" &&
    reference.startsWith("category:")
    ? reference.slice(9)
    : reference;
}

export function decisionSummary(bundle: InntrisEvidenceBundleV1): DecisionSummary {
  return {
    decision_id: bundle.decision.decision_id,
    verdict: bundle.decision.verdict,
    reason_codes: [...bundle.decision.reason_codes],
    action_hash: bundle.decision.action_hash,
    amount: bundle.action.transaction.amount,
    currency: bundle.action.transaction.asset,
    merchant: merchant(bundle),
    merchant_category: merchantCategory(bundle),
    mandate_id: extensionString(bundle, "mandate_id"),
    policy_version: bundle.decision.policy.policy_version,
    highnote_request_id: bundle.execution_reference.collaborative_authorization_request_id,
    highnote_transaction_id: bundle.execution_reference.transaction_id,
    highnote_response_code: bundle.execution_reference.response_code,
    created_at: bundle.decision.issued_at,
    signature_verified: bundle.source_observation.request_signature_verified,
    freshness_verified: bundle.source_observation.request_freshness_verified,
    evidence_bundle_id: bundle.bundle_id,
  };
}

function verificationResult(bundle: InntrisEvidenceBundleV1): EvidenceVerificationResult {
  try {
    return verifyEvidenceBundle(bundle, {
      at: new Date(Date.parse(bundle.decision.issued_at) + 1),
      expectedPolicyVersion: bundle.decision.policy.policy_version,
    });
  } catch {
    return {
      valid: false,
      checks: {
        schema: false,
        bundle_signature: false,
        key_registry: false,
        decision: false,
        highnote_binding: false,
        source_payload_binding: false,
      },
      trust_summary: {
        inntris_decision: "not verified",
        captured_payload_integrity: "not verified",
        highnote_transaction_fact: "reported by Highnote, not independently proven",
      },
    };
  }
}

export function decisionDetail(bundle: InntrisEvidenceBundleV1): DecisionDetail {
  const verification = verificationResult(bundle);
  return {
    ...decisionSummary(bundle),
    evidence_integrity: verification.valid ? "VERIFIED" : "INVALID",
    evidence_checks: verification.checks,
    decision: bundle.decision,
    action: bundle.action,
    execution_reference: bundle.execution_reference,
    source_observation: bundle.source_observation,
    integrity_metadata: bundle.integrity,
    verification_material: bundle.verification_material,
  };
}
