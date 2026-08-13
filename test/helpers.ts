import { readFile } from "node:fs/promises";

import {
  HighnoteAuthorisationProcessor,
  InMemoryIdempotencyStore,
  type DownstreamAuthorisationClient,
} from "../src/adapter/index.js";
import { canonicalise, Ed25519SigningProvider, type Clock } from "../src/contracts/index.js";
import {
  createHighnoteSignature,
  CollaborativeAuthorizationRequestSchema,
  type CollaborativeAuthorizationRequest,
} from "../src/highnote/index.js";
import { MandateSnapshotSchema, SnapshotMandateStore } from "../src/mandates/index.js";

export const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
export const HIGHNOTE_SECRET = "test-highnote-endpoint-secret";
export const clock: Clock = { now: () => new Date(FIXED_NOW) };
export const signer = Ed25519SigningProvider.fromSeed("test-highnote-key-1", Buffer.alloc(32, 7));

export async function testMandateStore(): Promise<SnapshotMandateStore> {
  const raw = await readFile(new URL("../config/mandates.test.json", import.meta.url), "utf8");
  return new SnapshotMandateStore(MandateSnapshotSchema.parse(JSON.parse(raw)));
}

export function highnoteRequest(
  overrides: {
    requestId?: string;
    transactionId?: string;
    paymentCardId?: string;
    amount?: number;
    currency?: string;
    merchantId?: string | null;
    merchantName?: string | null;
    merchantCategoryCode?: string | null;
    merchantCategory?: string | null;
    preliminaryResponseCode?: "APPROVED" | "PARTIAL_AMOUNT_APPROVED" | null;
    signatureTimestamp?: number;
    terminalSupportsPartialApproval?: boolean;
  } = {},
): CollaborativeAuthorizationRequest {
  return CollaborativeAuthorizationRequestSchema.parse({
    data: {
      collaborativeAuthorizationRequest: {
        __typename: "PaymentCardAuthorizationRequest",
        id: overrides.requestId ?? "te_allow_001",
        transaction: { id: overrides.transactionId ?? "tx_allow_001" },
        transactionTimestamp: "2026-08-12T11:59:59.900Z",
        paymentCard: { id: overrides.paymentCardId ?? "card_allow_001" },
        transactionAmount: {
          value: overrides.amount ?? 5000,
          currencyCode: overrides.currency ?? "USD",
        },
        settlementAmount: {
          value: overrides.amount ?? 5000,
          currencyCode: overrides.currency ?? "USD",
        },
        requestedAmount: {
          value: overrides.amount ?? 5000,
          currencyCode: overrides.currency ?? "USD",
        },
        surchargeFee: null,
        merchantDetails: {
          merchantId:
            overrides.merchantId === undefined ? "merchant_allowed_001" : overrides.merchantId,
          category:
            overrides.merchantCategory === undefined
              ? "MISCELLANEOUS_SPECIALTY_RETAIL"
              : overrides.merchantCategory,
          categoryCode:
            overrides.merchantCategoryCode === undefined ? "7399" : overrides.merchantCategoryCode,
          countryCodeAlpha3: "USA",
          description: "TEST BUSINESS SERVICES",
          name:
            overrides.merchantName === undefined
              ? "TEST BUSINESS SERVICES"
              : overrides.merchantName,
          address: {
            streetAddress: "",
            extendedAddress: null,
            postalCode: "94107",
            region: "CA",
            locality: "SAN FRANCISCO",
            countryCodeAlpha3: "USA",
          },
        },
        responseCode:
          overrides.preliminaryResponseCode === undefined
            ? "APPROVED"
            : overrides.preliminaryResponseCode,
        avsResponseCode: "MATCH",
        postalCodeResponseCode: "MATCH",
        cvvResponseCode: "MATCH",
        pointOfServiceDetails: {
          panEntryMode: "CONTACTLESS_VIA_CHIP_RULES",
          pinEntryMode: null,
          terminalAttendance: "UNATTENDED",
          isCardHolderPresent: false,
          isCardPresent: false,
          isRecurring: null,
          terminalSupportsPartialApproval: overrides.terminalSupportsPartialApproval ?? true,
          category: "ECOMMERCE",
          cardDataInputCapability: "CONTACTLESS_READ_VIA_CHIP_RULES",
        },
        additionalNetworkData: {
          __typename: "VisaData",
          retrievalReferenceNumber: "020000654321",
          acquiringInstitutionIdentificationCode: "067890",
          paymentFacilitatorIdentifier: null,
          riskScore: null,
        },
        createdAt: "2026-08-12T11:59:59.900Z",
      },
    },
    extensions: {
      signatureTimestamp: overrides.signatureTimestamp ?? FIXED_NOW.getTime(),
    },
  });
}

export function signedBody(request: CollaborativeAuthorizationRequest): {
  rawBody: Buffer;
  signature: string;
} {
  const rawBody = Buffer.from(canonicalise(request), "utf8");
  return {
    rawBody,
    signature: createHighnoteSignature(rawBody, HIGHNOTE_SECRET, "hex"),
  };
}

export async function testProcessor(
  options: {
    downstreamClient?: DownstreamAuthorisationClient;
  } = {},
): Promise<HighnoteAuthorisationProcessor> {
  return new HighnoteAuthorisationProcessor({
    mandateStore: await testMandateStore(),
    signer,
    clock,
    actionResource: "https://adapter.example.test/v1/highnote/collaborative-authorization",
    idempotencyStore: new InMemoryIdempotencyStore(),
    decisionIdFactory: () => "decision-highnote-test-001",
    nonceFactory: () => "Zml4ZWQtaGlnaG5vdGUtbm9uY2U",
    bundleIdFactory: () => "bundle-highnote-test-001",
    ...(options.downstreamClient === undefined
      ? {}
      : { downstreamClient: options.downstreamClient }),
  });
}
