import { AdapterError } from "../errors.js";
import {
  hashCanonical,
  InntrisActionV1Schema,
  sha256Bytes,
  type InntrisActionV1,
} from "../contracts/index.js";
import type { CollaborativeAuthorizationRequest } from "../highnote/index.js";
import type { MandateRecord } from "../mandates/index.js";

function currencyFractionDigits(currency: string): number {
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

export function actionFromHighnote(input: {
  request: CollaborativeAuthorizationRequest;
  rawBody: Uint8Array;
  mandate: MandateRecord;
  resource: string;
}): InntrisActionV1 {
  const request = input.request.data.collaborativeAuthorizationRequest;
  const merchantId = request.merchantDetails.merchantId;
  const merchantName = request.merchantDetails.name;
  const merchantCategoryCode = request.merchantDetails.categoryCode;
  const merchantCategory = request.merchantDetails.category;
  const payee = merchantId ?? (merchantName === null ? null : `name:${merchantName}`);
  const categoryReference =
    merchantCategoryCode ?? (merchantCategory === null ? null : `category:${merchantCategory}`);
  if (payee === null || categoryReference === null) {
    throw new AdapterError(
      "MISSING_MANDATE_IDENTITY",
      "The Highnote request lacks a merchant identifier or category code required by policy",
      422,
    );
  }
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
      merchant_identity_source: merchantId === null ? "name" : "merchant_id",
      merchant_category_source:
        merchantCategoryCode === null || merchantCategoryCode === undefined
          ? "category"
          : "category_code",
      merchant_category_reference: categoryReference,
    },
  });
}
