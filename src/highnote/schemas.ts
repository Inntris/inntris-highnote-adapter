import { z } from "zod";

const TimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");

export const HighnoteAmountSchema = z
  .object({
    value: z.number().int().nonnegative().safe(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  })
  .strict();

const AddressSchema = z
  .object({
    streetAddress: z.string().nullable(),
    extendedAddress: z.string().nullable(),
    postalCode: z.string().nullable(),
    region: z.union([z.string(), z.number()]).nullable(),
    locality: z.string().nullable(),
    countryCodeAlpha3: z.string().nullable(),
  })
  .strict();

export const MerchantDetailsSchema = z
  .object({
    merchantId: z.string().min(1).nullable(),
    category: z.string().min(1).nullable(),
    categoryCode: z.string().min(1).nullable().optional(),
    countryCodeAlpha3: z.string().min(1).nullable(),
    description: z.string().nullable(),
    name: z.string().min(1).nullable(),
    address: AddressSchema.nullable(),
  })
  .strict();

/**
 * Point of sale semantics as they appear in the Highnote simulation input,
 * under `pointOfServiceDetails`.
 */
export const PointOfServiceDetailsSchema = z
  .object({
    panEntryMode: z.string().nullable(),
    pinEntryMode: z.string().nullable(),
    terminalAttendance: z.string().nullable(),
    isCardHolderPresent: z.boolean().nullable(),
    isCardPresent: z.boolean().nullable(),
    isRecurring: z.boolean().nullable(),
    terminalSupportsPartialApproval: z.boolean(),
    category: z.string().nullable(),
    cardDataInputCapability: z.string().nullable(),
  })
  .strict();

/**
 * The same point of sale semantics as they appear in the Highnote callback
 * example, under `pointOfSaleDetails`.
 *
 * The documented callback example carries `panEntryMode`, `pinEntryMode`,
 * `terminalAttendance`, `isCardHolderPresent`, `isCardPresent`, `isRecurring`
 * and `terminalSupportsPartialApproval`. It does not carry `category` or
 * `cardDataInputCapability`, so those two are modelled explicitly as optional
 * compatibility fields rather than assumed to be present.
 *
 * Only `terminalSupportsPartialApproval` is a policy input, so it is required
 * here exactly as it is in `PointOfServiceDetailsSchema`. The remaining
 * descriptive fields are optional because Highnote documents that point of
 * sale details are omitted when not applicable, and none of them can widen
 * authority. Unknown keys still fail closed.
 */
export const PointOfSaleDetailsSchema = z
  .object({
    panEntryMode: z.string().nullable().optional(),
    pinEntryMode: z.string().nullable().optional(),
    terminalAttendance: z.string().nullable().optional(),
    isCardHolderPresent: z.boolean().nullable().optional(),
    isCardPresent: z.boolean().nullable().optional(),
    isRecurring: z.boolean().nullable().optional(),
    terminalSupportsPartialApproval: z.boolean(),
    category: z.string().nullable().optional(),
    cardDataInputCapability: z.string().nullable().optional(),
  })
  .strict();

const NetworkDataBase = {
  retrievalReferenceNumber: z.string().nullable(),
  acquiringInstitutionIdentificationCode: z.string().nullable(),
  paymentFacilitatorIdentifier: z.string().nullable(),
};

export const AdditionalNetworkDataSchema = z.discriminatedUnion("__typename", [
  z
    .object({
      __typename: z.literal("VisaData"),
      ...NetworkDataBase,
      riskScore: z.number().nullable(),
    })
    .strict(),
  z
    .object({
      __typename: z.literal("MastercardData"),
      ...NetworkDataBase,
      fraudScore: z.number().nullable(),
    })
    .strict(),
]);

export const PaymentCardAuthorizationRequestSchema = z
  .object({
    __typename: z.literal("PaymentCardAuthorizationRequest"),
    id: z.string().min(1).max(128),
    transaction: z.object({ id: z.string().min(1).max(128) }).strict(),
    transactionTimestamp: TimestampSchema,
    paymentCard: z.object({ id: z.string().min(1).max(128) }).strict(),
    transactionAmount: HighnoteAmountSchema,
    settlementAmount: HighnoteAmountSchema,
    requestedAmount: HighnoteAmountSchema,
    surchargeFee: HighnoteAmountSchema.nullable(),
    merchantDetails: MerchantDetailsSchema,
    responseCode: z.enum(["APPROVED", "PARTIAL_AMOUNT_APPROVED"]).nullable(),
    avsResponseCode: z.string().nullable(),
    postalCodeResponseCode: z.string().nullable(),
    cvvResponseCode: z.string().nullable(),
    pointOfServiceDetails: PointOfServiceDetailsSchema.optional(),
    pointOfSaleDetails: PointOfSaleDetailsSchema.optional(),
    // Documented in the Highnote callback example. Accepted so a documented
    // request parses, never read as an authority signal or policy input.
    networkRetrievalReferenceNumber: z.string().max(64).nullable().optional(),
    additionalNetworkData: AdditionalNetworkDataSchema.optional(),
    cashBackAmount: HighnoteAmountSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict()
  // Both documented point of sale representations carry the same semantics, so
  // a request that supplies both is ambiguous rather than redundant: the two
  // objects could disagree on `terminalSupportsPartialApproval`. Rejecting the
  // request keeps the adapter from silently picking one reading.
  .refine(
    (value) => value.pointOfServiceDetails === undefined || value.pointOfSaleDetails === undefined,
    {
      error:
        "Ambiguous point of sale representation: supply pointOfServiceDetails or pointOfSaleDetails, not both",
      path: ["pointOfSaleDetails"],
    },
  );

export const CollaborativeAuthorizationRequestSchema = z
  .object({
    data: z
      .object({ collaborativeAuthorizationRequest: PaymentCardAuthorizationRequestSchema })
      .strict(),
    extensions: z.object({ signatureTimestamp: z.number().int().nonnegative().safe() }).strict(),
  })
  .strict();

/**
 * Highnote's endpoint activation verification probe.
 *
 * Observed on 13 August 2026: an HMAC signed POST whose
 * `data.collaborativeAuthorizationRequest` carries `ping` as its first reported
 * key, alongside a normal `extensions.signatureTimestamp`. Railway's
 * structured log rendering exposed only the first member of Zod's key array,
 * so additional opaque probe metadata cannot be ruled out. The message carries
 * none of the transaction, card, amount or merchant fields that identify an
 * authorisation request.
 *
 * This is a separately validated message type on the same authenticated
 * boundary, not a bypass. A probe is acknowledged only after it passes the same
 * signature verification and the same freshness window that an authorisation
 * request must pass.
 *
 * The `ping` value and any accompanying probe metadata are undocumented and
 * are never read as policy inputs. The schema therefore preserves opaque probe
 * metadata, while its refinement rejects every transaction-bearing marker and
 * the PaymentCardAuthorizationRequest typename. A malformed authorisation that
 * carries `ping` therefore cannot be reclassified as a probe and answered with
 * a 2xx.
 */
const AuthorizationRequestMarkerKeys = [
  "transaction",
  "transactionTimestamp",
  "paymentCard",
  "transactionAmount",
  "settlementAmount",
  "requestedAmount",
  "surchargeFee",
  "merchantDetails",
  "responseCode",
  "avsResponseCode",
  "postalCodeResponseCode",
  "cvvResponseCode",
  "pointOfServiceDetails",
  "pointOfSaleDetails",
  "networkRetrievalReferenceNumber",
  "additionalNetworkData",
  "cashBackAmount",
  "createdAt",
] as const;

const HighnoteEndpointPingPayloadSchema = z
  .object({
    ping: z.unknown(),
    __typename: z.string().min(1).max(128).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.__typename === "PaymentCardAuthorizationRequest") {
      context.addIssue({
        code: "custom",
        path: ["__typename"],
        message: "An authorisation request cannot be treated as an endpoint probe",
      });
    }
    for (const key of AuthorizationRequestMarkerKeys) {
      if (Object.hasOwn(value, key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "An authorisation request cannot be treated as an endpoint probe",
        });
      }
    }
  });

export const HighnoteEndpointPingSchema = z
  .object({
    data: z
      .object({ collaborativeAuthorizationRequest: HighnoteEndpointPingPayloadSchema })
      .strict(),
    extensions: z.object({ signatureTimestamp: z.number().int().nonnegative().safe() }).strict(),
  })
  .strict();

export const CollaborativeAuthorizationResponseCodeSchema = z.enum([
  "APPROVED",
  "DECLINED",
  "PARTIAL_AMOUNT_APPROVED",
  "INSUFFICIENT_FUNDS",
  "EXCEEDS_LIMIT",
  "EXCEEDS_FREQUENCY",
  "INVALID_MERCHANT",
  "RESTRICTED_CARD",
  "SUSPECTED_FRAUD",
  "CASHBACK_LIMIT_EXCEEDED",
  "RESTRICTED_LOCATION",
  "CARD_NOT_PRESENT_AT_POS",
  "MANUAL_KEY_ENTERED_AT_POS",
  "BLOCKED_CARD",
  "INVALID_DRIVER",
  "INVALID_VEHICLE",
  "INVALID_ID",
  "INVALID_LOCATION",
  "INVALID_TRANSACTION",
  "INVALID_PURCHASE_TIME",
  "INVALID_MERCHANT_CATEGORY_CODE",
  "DUPLICATE_TRANSACTION",
  "PROHIBITED_SELFPAY",
  "RESTRICTED_MERCHANT",
  "RESTRICTED_MERCHANT_CATEGORY_CODE",
]);

export const CollaborativeAuthorizationResponseSchema = z
  .object({
    transaction: z.object({ id: z.string().min(1).max(128) }).strict(),
    responseCode: CollaborativeAuthorizationResponseCodeSchema,
    authorizedAmount: HighnoteAmountSchema.optional(),
  })
  .strict();

export type CollaborativeAuthorizationRequest = z.infer<
  typeof CollaborativeAuthorizationRequestSchema
>;
export type PaymentCardAuthorizationRequest = z.infer<typeof PaymentCardAuthorizationRequestSchema>;
export type PointOfServiceDetails = z.infer<typeof PointOfServiceDetailsSchema>;
export type PointOfSaleDetails = z.infer<typeof PointOfSaleDetailsSchema>;
export type HighnoteEndpointPing = z.infer<typeof HighnoteEndpointPingSchema>;
export type CollaborativeAuthorizationResponse = z.infer<
  typeof CollaborativeAuthorizationResponseSchema
>;
export type HighnoteAmount = z.infer<typeof HighnoteAmountSchema>;
export type CollaborativeAuthorizationResponseCode = z.infer<
  typeof CollaborativeAuthorizationResponseCodeSchema
>;

/**
 * Reads point of sale semantics from whichever documented representation the
 * request used, without rewriting the parsed request.
 *
 * The parsed structure is left exactly as Highnote sent it because the adapter
 * binds evidence to that structure and separately hashes the exact raw bytes.
 * Schema validation already rejects a request carrying both representations,
 * so the two branches can never disagree here.
 */
export function getPointOfServiceDetails(
  request: PaymentCardAuthorizationRequest,
): PointOfServiceDetails | PointOfSaleDetails | undefined {
  return request.pointOfServiceDetails ?? request.pointOfSaleDetails;
}
