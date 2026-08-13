import type { InntrisActionV1, ReasonCode, UnsignedEvaluation } from "../contracts/index.js";
import type { MandateRecord } from "./schemas.js";

export interface MandateEvaluationInput {
  action: InntrisActionV1;
  mandate: MandateRecord;
  requestedAmountMinor: number;
  at: Date;
  expectedPolicyVersion?: string;
}

function block(reasonCode: ReasonCode): UnsignedEvaluation {
  return {
    verdict: "BLOCK",
    reasonCodes: [reasonCode],
    approval: { mode: "policy_engine", approval_reference: null, approver_ids: [] },
  };
}

export function evaluateMandate(input: MandateEvaluationInput): UnsignedEvaluation {
  const { action, mandate, at } = input;
  if (action.principal_id !== mandate.principal_id) return block("KYA_PRINCIPAL_MISMATCH");
  if (action.agent_id !== mandate.agent_id) return block("KYA_AGENT_IDENTITY_MISMATCH");
  if (
    at.getTime() < Date.parse(mandate.valid_from) ||
    at.getTime() >= Date.parse(mandate.valid_until)
  ) {
    return block("POLICY_EXPIRED");
  }
  if (
    input.expectedPolicyVersion !== undefined &&
    input.expectedPolicyVersion !== mandate.policy.version
  ) {
    return block("POLICY_VERSION_MISMATCH");
  }
  if (mandate.state === "REVOKED") return block("KYA_DELEGATION_REVOKED");
  if (action.transaction.asset !== mandate.policy.currency) return block("ASSET_NOT_ALLOWED");
  if (BigInt(input.requestedAmountMinor) > BigInt(mandate.policy.max_amount_minor)) {
    return block("AMOUNT_EXCEEDS_TRANSACTION_LIMIT");
  }
  const merchantIdentitySource = action.extensions?.["merchant_identity_source"];
  const merchantAllowed =
    merchantIdentitySource === "merchant_id"
      ? mandate.policy.allowed_merchant_ids.includes(action.transaction.payee)
      : merchantIdentitySource === "name" && action.transaction.payee.startsWith("name:")
        ? mandate.policy.allowed_merchant_names.includes(action.transaction.payee.slice(5))
        : false;
  if (!merchantAllowed) {
    return block("PAYEE_NOT_ALLOWED");
  }
  const merchantCategorySource = action.extensions?.["merchant_category_source"];
  const merchantCategoryValue = action.extensions?.["merchant_category_reference"];
  const categoryAllowed =
    merchantCategorySource === "category_code" && typeof merchantCategoryValue === "string"
      ? mandate.policy.allowed_merchant_category_codes.includes(merchantCategoryValue)
      : merchantCategorySource === "category" &&
          typeof merchantCategoryValue === "string" &&
          merchantCategoryValue.startsWith("category:")
        ? mandate.policy.allowed_merchant_categories.includes(merchantCategoryValue.slice(9))
        : false;
  if (!categoryAllowed) {
    return block("RESOURCE_NOT_ALLOWED");
  }
  // Approval is only meaningful once the action would otherwise be allowed. A
  // transaction that breaches the policy is blocked on its own reason code so
  // the signed evidence records why, rather than implying that a human
  // approval could have authorised it.
  if (mandate.state === "REQUIRES_APPROVAL") {
    return {
      verdict: "REQUIRE_APPROVAL",
      reasonCodes: ["HUMAN_APPROVAL_REQUIRED"],
      approval: { mode: "human", approval_reference: null, approver_ids: [] },
    };
  }
  return {
    verdict: "ALLOW",
    reasonCodes: ["MERCHANT_ALLOWED", "WITHIN_TRANSACTION_LIMIT"],
    approval: { mode: "policy_engine", approval_reference: null, approver_ids: [] },
  };
}
