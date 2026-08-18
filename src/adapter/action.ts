import { createHash } from "node:crypto";

import { AdapterError } from "../errors.js";
import {
  canonicalise,
  hashCanonical,
  InntrisActionV1Schema,
  sha256Bytes,
  type InntrisActionV1,
} from "../contracts/index.js";
import type { CollaborativeAuthorizationRequest } from "../highnote/index.js";
import type { MandateRecord } from "../mandates/index.js";

// `Intl.NumberFormat` silently falls back to two fraction digits for a
// well-formed but unknown currency code, so the code is checked against the
// runtime currency list before its exponent is trusted.
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

// Matches `IdentifierSchema` in the shared upstream contract.
const MAX_MERCHANT_REFERENCE_LENGTH = 128;

export interface InntrisCoreFinancialPayload {
  amount: string;
  currency: "USD";
  payee: string;
  merchant_category: string;
  provider: "highnote";
  rail: "card";
  request_ref: string;
  highnote_request_id: string;
  highnote_transaction_id: string;
  credential_reference_hash: `sha256:${string}`;
  source_request_hash: `sha256:${string}`;
}

function currencyFractionDigits(currency: string): number {
  if (!supportedCurrencies.has(currency)) {
    throw new AdapterError("UNSUPPORTED_CURRENCY", `Unsupported currency ${currency}`, 422);
  }
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
    if (digits === undefined) throw new RangeError("Currency has no fraction digit metadata");
    return digits;
  } catch {
    throw new AdapterError("UNSUPPORTED_CURRENCY", `Unsupported currency ${currency}`, 422);
  }
}

export function minorAmountToCanonical(value: number, currency: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AdapterError(
      "INVALID_AMOUNT",
      "Highnote amount is not a safe nonnegative integer",
      422,
    );
  }
  const exponent = currencyFractionDigits(currency);
  const digits = value.toString().padStart(exponent + 1, "0");
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const nativeFraction = exponent === 0 ? "" : digits.slice(-exponent);
  const fraction = nativeFraction.padEnd(2, "0").replace(/0+$/u, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}

function cardNetwork(request: CollaborativeAuthorizationRequest): string {
  const networkData = request.data.collaborativeAuthorizationRequest.additionalNetworkData;
  if (networkData?.__typename === "VisaData") return "visa";
  if (networkData?.__typename === "MastercardData") return "mastercard";
  return "unknown";
}

function merchantReferences(request: CollaborativeAuthorizationRequest): {
  payee: string;
  categoryReference: string;
} {
  const authorisation = request.data.collaborativeAuthorizationRequest;
  const merchantId = authorisation.merchantDetails.merchantId;
  const merchantName = authorisation.merchantDetails.name;
  const merchantCategoryCode = authorisation.merchantDetails.categoryCode;
  const merchantCategory = authorisation.merchantDetails.category;
  const payee =
    merchantId === null || merchantId === ""
      ? merchantName === null
        ? null
        : `name:${merchantName}`
      : merchantId;
  const categoryReference =
    merchantCategoryCode ?? (merchantCategory === null ? null : `category:${merchantCategory}`);
  if (payee === null || categoryReference === null) {
    throw new AdapterError(
      "MISSING_MANDATE_IDENTITY",
      "The Highnote request lacks a merchant identifier or category code required by policy",
      422,
    );
  }
  if (payee.length > MAX_MERCHANT_REFERENCE_LENGTH) {
    throw new AdapterError(
      "MERCHANT_REFERENCE_TOO_LONG",
      `The Highnote merchant reference exceeds ${MAX_MERCHANT_REFERENCE_LENGTH} characters`,
      422,
    );
  }
  return { payee, categoryReference };
}

function coreCardReferenceHash(agentId: string, paymentCardId: string): `sha256:${string}` {
  const digest = createHash("sha256")
    .update(
      canonicalise({
        namespace: "inntris-highnote-card-v1",
        agent_id: agentId,
        payment_card_id: paymentCardId,
      }),
      "utf8",
    )
    .digest("hex");
  return `sha256:${digest}`;
}

export function corePayloadFromHighnote(input: {
  request: CollaborativeAuthorizationRequest;
  rawBody: Uint8Array;
  agentId: string;
}): InntrisCoreFinancialPayload {
  const request = input.request.data.collaborativeAuthorizationRequest;
  if (request.requestedAmount.currencyCode !== "USD") {
    throw new AdapterError(
      "UNSUPPORTED_CURRENCY",
      "Inntris Core card limits are denominated in USD; non-USD authorisations are declined",
      422,
    );
  }
  const { payee, categoryReference } = merchantReferences(input.request);
  const requestRef = `highnote:${request.id}`;
  return {
    amount: minorAmountToCanonical(request.requestedAmount.value, "USD"),
    currency: "USD",
    payee,
    merchant_category: categoryReference,
    provider: "highnote",
    rail: "card",
    request_ref: requestRef,
    highnote_request_id: request.id,
    highnote_transaction_id: request.transaction.id,
    credential_reference_hash: coreCardReferenceHash(input.agentId, request.paymentCard.id),
    source_request_hash: sha256Bytes(input.rawBody),
  };
}

export function actionFromHighnote(input: {
  request: CollaborativeAuthorizationRequest;
  rawBody: Uint8Array;
  mandate: MandateRecord;
  resource: string;
}): InntrisActionV1 {
  const request = input.request.data.collaborativeAuthorizationRequest;
  const merchantId = request.merchantDetails.merchantId;
  const merchantCategoryCode = request.merchantDetails.categoryCode;
  const { payee, categoryReference } = merchantReferences(input.request);
  const network = cardNetwork(input.request);
  return InntrisActionV1Schema.parse({
    version: "inntris-action-v1",
    principal_id: input.mandate.principal_id,
    agent_id: input.mandate.agent_id,
    action_type: "financial_transaction",
    rail: "card",
    transaction: {
      amount: minorAmountToCanonical(
        request.requestedAmount.value,
        request.requestedAmount.currencyCode,
      ),
      asset: request.requestedAmount.currencyCode,
      network: `card:${network}`,
      payee,
      purpose: input.mandate.purpose,
    },
    protocol_reference: {
      type: "card",
      resource: input.resource,
      authorisation_request_id: request.id,
      merchant_id: payee,
      card_network: network,
      credential_reference_hash: hashCanonical(request.paymentCard.id),
      authorisation_request_hash: hashCanonical(input.request),
    },
    extensions: {
      provider: "highnote",
      organisation_id: input.mandate.organisation_id,
      mandate_id: input.mandate.mandate_id,
      policy_version: input.mandate.policy.version,
      highnote_transaction_id: request.transaction.id,
      highnote_source_payload_hash: sha256Bytes(input.rawBody),
      merchant_identity_source: merchantId === null || merchantId === "" ? "name" : "merchant_id",
      merchant_category_source:
        merchantCategoryCode === null || merchantCategoryCode === undefined
          ? "category"
          : "category_code",
      merchant_category_reference: categoryReference,
    },
  });
}
