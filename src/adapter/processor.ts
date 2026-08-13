import { randomBytes, randomUUID } from "node:crypto";

import {
  buildKeyRegistryEntry,
  createSignedDecision,
  hashCanonical,
  hashPolicyObject,
  KeyRegistrySchema,
  sha256Bytes,
  type Clock,
  type InntrisDecisionV1,
  type KeyRegistry,
  type SigningProvider,
  type UnsignedEvaluation,
} from "../contracts/index.js";
import { AdapterError } from "../errors.js";
import { createEvidenceBundle, type InntrisEvidenceBundleV1 } from "../evidence/index.js";
import {
  getPointOfServiceDetails,
  type CollaborativeAuthorizationRequest,
  type CollaborativeAuthorizationResponse,
} from "../highnote/index.js";
import { evaluateMandate, type MandateStore } from "../mandates/index.js";
import { actionFromHighnote } from "./action.js";
import { composeAuthorisation, type AuthorisationOutcome } from "./composition.js";
import type { DownstreamAuthorisationClient } from "./downstream.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";

interface ProcessedValue {
  response: CollaborativeAuthorizationResponse;
  bundle: InntrisEvidenceBundleV1;
  decision: InntrisDecisionV1;
  downstreamOutcome: "not_configured" | "allow" | "block" | "bypassed";
}

export interface ProcessedAuthorisation extends ProcessedValue {
  replayed: boolean;
}

function outcomeFromEvaluation(
  evaluation: UnsignedEvaluation,
  requestedAmount: { value: number; currencyCode: string },
): AuthorisationOutcome {
  if (evaluation.verdict === "ALLOW") {
    return { allowed: true, responseCode: "APPROVED", authorizedAmount: requestedAmount };
  }
  const reason = evaluation.reasonCodes[0];
  const responseCode =
    reason === "AMOUNT_EXCEEDS_TRANSACTION_LIMIT"
      ? "EXCEEDS_LIMIT"
      : reason === "PAYEE_NOT_ALLOWED"
        ? "RESTRICTED_MERCHANT"
        : reason === "RESOURCE_NOT_ALLOWED"
          ? "RESTRICTED_MERCHANT_CATEGORY_CODE"
          : "INVALID_TRANSACTION";
  return { allowed: false, responseCode };
}

export class HighnoteAuthorisationProcessor {
  readonly #keyRegistry: KeyRegistry;
  readonly #idempotencyStore: InMemoryIdempotencyStore;

  constructor(
    readonly options: {
      mandateStore: MandateStore;
      signer: SigningProvider;
      clock: Clock;
      actionResource: string;
      decisionTtlSeconds?: number;
      idempotencyStore?: InMemoryIdempotencyStore;
      downstreamClient?: DownstreamAuthorisationClient;
      decisionIdFactory?: () => string;
      nonceFactory?: () => string;
      bundleIdFactory?: () => string;
      keyRegistry?: KeyRegistry;
    },
  ) {
    this.#idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.#keyRegistry = KeyRegistrySchema.parse(
      options.keyRegistry ?? {
        version: "inntris-key-registry-v1",
        keys: [
          buildKeyRegistryEntry(options.signer, {
            notBefore: new Date("2026-01-01T00:00:00.000Z"),
          }),
        ],
      },
    );
  }

  /** True when the pre-warmed mandate snapshot can resolve at least one card. */
  isReady(): boolean {
    return this.options.mandateStore.size > 0;
  }

  async process(input: {
    request: CollaborativeAuthorizationRequest;
    rawBody: Uint8Array;
    highnoteSignature: string;
  }): Promise<ProcessedAuthorisation> {
    const highnoteRequest = input.request.data.collaborativeAuthorizationRequest;
    const mandate = this.options.mandateStore.findByPaymentCardId(highnoteRequest.paymentCard.id);
    if (mandate === undefined) {
      throw new AdapterError(
        "MANDATE_NOT_FOUND",
        "No pre-warmed organisational mandate matches the Highnote payment card reference",
        422,
      );
    }
    const payloadHash = hashCanonical(input.request);
    const result = await this.#idempotencyStore.execute<ProcessedValue>(
      highnoteRequest.id,
      payloadHash,
      async () => {
        const action = actionFromHighnote({
          request: input.request,
          rawBody: input.rawBody,
          mandate,
          resource: this.options.actionResource,
        });
        const evaluation = evaluateMandate({
          action,
          mandate,
          requestedAmountMinor: highnoteRequest.requestedAmount.value,
          at: this.options.clock.now(),
          expectedPolicyVersion: mandate.policy.version,
        });
        const decision = await createSignedDecision({
          action,
          evaluation,
          policyHash: hashPolicyObject(mandate.policy),
          policyVersion: mandate.policy.version,
          decisionTtlSeconds: this.options.decisionTtlSeconds ?? 30,
          signer: this.options.signer,
          clock: this.options.clock,
          decisionId: this.options.decisionIdFactory?.() ?? randomUUID(),
          nonce: this.options.nonceFactory?.() ?? randomBytes(24).toString("base64url"),
        });
        const inntrisOutcome = outcomeFromEvaluation(evaluation, highnoteRequest.requestedAmount);
        const downstreamOutcome = await this.options.downstreamClient?.authorise({
          rawBody: input.rawBody,
          highnoteSignature: input.highnoteSignature,
          transactionId: highnoteRequest.transaction.id,
        });
        const response = composeAuthorisation({
          transactionId: highnoteRequest.transaction.id,
          requestedAmount: highnoteRequest.requestedAmount,
          terminalSupportsPartialApproval:
            getPointOfServiceDetails(highnoteRequest)?.terminalSupportsPartialApproval ?? false,
          inntris: inntrisOutcome,
          ...(downstreamOutcome === undefined ? {} : { downstream: downstreamOutcome }),
        });
        const bundle = await createEvidenceBundle({
          bundleId: this.options.bundleIdFactory?.() ?? `bundle-${randomUUID()}`,
          action,
          decision,
          response,
          sourcePayloadHash: sha256Bytes(input.rawBody),
          signer: this.options.signer,
          keyRegistry: this.#keyRegistry,
        });
        const downstreamStatus =
          this.options.downstreamClient === undefined
            ? "not_configured"
            : downstreamOutcome === undefined
              ? "bypassed"
              : downstreamOutcome.allowed
                ? "allow"
                : "block";
        return { response, bundle, decision, downstreamOutcome: downstreamStatus };
      },
    );
    return { ...result.value, replayed: result.replayed };
  }
}
