import { AdapterError } from "../errors.js";
import {
  CollaborativeAuthorizationResponseSchema,
  type CollaborativeAuthorizationResponse,
  type CollaborativeAuthorizationResponseCode,
  type HighnoteAmount,
} from "../highnote/index.js";

export interface AuthorisationOutcome {
  allowed: boolean;
  responseCode: CollaborativeAuthorizationResponseCode;
  authorizedAmount?: HighnoteAmount;
}

const approvedCodes = new Set<CollaborativeAuthorizationResponseCode>([
  "APPROVED",
  "PARTIAL_AMOUNT_APPROVED",
]);

export function outcomeFromResponse(
  responseInput: unknown,
  expectedTransactionId: string,
): AuthorisationOutcome {
  const response = CollaborativeAuthorizationResponseSchema.parse(responseInput);
  if (response.transaction.id !== expectedTransactionId) {
    throw new AdapterError(
      "DOWNSTREAM_TRANSACTION_MISMATCH",
      "Downstream response transaction id does not match the Highnote request",
      502,
    );
  }
  return {
    allowed: approvedCodes.has(response.responseCode),
    responseCode: response.responseCode,
    ...(response.authorizedAmount === undefined
      ? {}
      : { authorizedAmount: response.authorizedAmount }),
  };
}

function comparableMinor(amount: HighnoteAmount, currency: string): number {
  if (amount.currencyCode !== currency) {
    throw new AdapterError(
      "DOWNSTREAM_CURRENCY_MISMATCH",
      "Downstream response currency does not match requested amount",
      502,
    );
  }
  return amount.value;
}

export function composeAuthorisation(input: {
  transactionId: string;
  requestedAmount: HighnoteAmount;
  terminalSupportsPartialApproval: boolean;
  inntris: AuthorisationOutcome;
  downstream?: AuthorisationOutcome;
}): CollaborativeAuthorizationResponse {
  const downstream = input.downstream;
  if (!input.inntris.allowed) {
    return { transaction: { id: input.transactionId }, responseCode: input.inntris.responseCode };
  }
  if (downstream !== undefined && !downstream.allowed) {
    return { transaction: { id: input.transactionId }, responseCode: downstream.responseCode };
  }

  const ceilings = [
    input.inntris.authorizedAmount,
    downstream?.authorizedAmount,
    input.requestedAmount,
  ].filter((value): value is HighnoteAmount => value !== undefined);
  const smallest = ceilings.reduce((left, right) =>
    comparableMinor(left, input.requestedAmount.currencyCode) <=
    comparableMinor(right, input.requestedAmount.currencyCode)
      ? left
      : right,
  );
  if (smallest.value < input.requestedAmount.value) {
    if (!input.terminalSupportsPartialApproval) {
      return { transaction: { id: input.transactionId }, responseCode: "INVALID_TRANSACTION" };
    }
    return {
      transaction: { id: input.transactionId },
      responseCode: "PARTIAL_AMOUNT_APPROVED",
      authorizedAmount: smallest,
    };
  }
  return { transaction: { id: input.transactionId }, responseCode: "APPROVED" };
}
