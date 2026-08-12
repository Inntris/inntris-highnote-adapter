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

export const CollaborativeAuthorizationRequestSchema = z
  .object({
    data: z
      .object({
        collaborativeAuthorizationRequest: z
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
            additionalNetworkData: AdditionalNetworkDataSchema.optional(),
            cashBackAmount: HighnoteAmountSchema.optional(),
            createdAt: TimestampSchema,
          })
          .strict(),
      })
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
export type CollaborativeAuthorizationResponse = z.infer<
  typeof CollaborativeAuthorizationResponseSchema
>;
export type HighnoteAmount = z.infer<typeof HighnoteAmountSchema>;
export type CollaborativeAuthorizationResponseCode = z.infer<
  typeof CollaborativeAuthorizationResponseCodeSchema
>;
