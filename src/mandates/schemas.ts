import { z } from "zod";

const TimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");

export const MandateRecordSchema = z
  .object({
    payment_card_id: z.string().min(1).max(128),
    organisation_id: z.string().min(1).max(128),
    principal_id: z.string().min(1).max(128),
    agent_id: z.string().min(1).max(128),
    mandate_id: z.string().min(1).max(128),
    purpose: z.string().min(1).max(128),
    state: z.enum(["APPROVED", "REQUIRES_APPROVAL", "REVOKED"]),
    valid_from: TimestampSchema,
    valid_until: TimestampSchema,
    policy: z
      .object({
        version: z.string().min(1).max(64),
        currency: z.string().regex(/^[A-Z]{3}$/u),
        max_amount_minor: z.string().regex(/^(0|[1-9]\d*)$/u),
        allowed_merchant_ids: z.array(z.string().min(1).max(128)),
        allowed_merchant_names: z.array(z.string().min(1).max(256)).default([]),
        allowed_merchant_category_codes: z.array(z.string().min(1).max(32)),
        allowed_merchant_categories: z.array(z.string().min(1).max(128)).default([]),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, context) => {
    if (Date.parse(record.valid_until) <= Date.parse(record.valid_from)) {
      context.addIssue({
        code: "custom",
        message: "valid_until must be later than valid_from",
        path: ["valid_until"],
      });
    }
  });

export const MandateSnapshotSchema = z
  .object({
    version: z.literal("inntris-highnote-mandate-snapshot-v1"),
    generated_at: TimestampSchema,
    records: z.array(MandateRecordSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const cardIds = snapshot.records.map((record) => record.payment_card_id);
    if (new Set(cardIds).size !== cardIds.length) {
      context.addIssue({
        code: "custom",
        message: "payment_card_id values must be unique",
        path: ["records"],
      });
    }
  });

export type MandateRecord = z.infer<typeof MandateRecordSchema>;
export type MandateSnapshot = z.infer<typeof MandateSnapshotSchema>;
