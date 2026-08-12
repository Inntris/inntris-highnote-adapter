import { z } from "zod";

import {
  Base64UrlSchema,
  HashSchema,
  IdentifierSchema,
  InntrisActionV1Schema,
  InntrisDecisionV1Schema,
  KeyRegistrySchema,
} from "../contracts/index.js";
import {
  CollaborativeAuthorizationResponseCodeSchema,
  HighnoteAmountSchema,
} from "../highnote/index.js";

export const AttestationClassSchema = z.enum([
  "self",
  "cryptographically_verified",
  "reported",
  "observed",
]);

export const InntrisEvidenceBundleV1Schema = z
  .object({
    version: z.literal("inntris-evidence-bundle-v1"),
    compatibility_status: z.literal("proposed-until-upstream-adoption"),
    bundle_id: IdentifierSchema,
    action: InntrisActionV1Schema,
    decision: InntrisDecisionV1Schema,
    execution_reference: z
      .object({
        rail: z.literal("card"),
        provider: z.literal("highnote"),
        collaborative_authorization_request_id: IdentifierSchema,
        transaction_id: IdentifierSchema,
        response_code: CollaborativeAuthorizationResponseCodeSchema,
        authorized_amount: HighnoteAmountSchema.nullable(),
        attestation_class: z.literal("reported"),
      })
      .strict(),
    source_observation: z
      .object({
        payload_hash: HashSchema,
        request_signature_verified: z.boolean(),
        request_freshness_verified: z.boolean(),
        attestation_class: z.literal("observed"),
      })
      .strict(),
    attestations: z.array(
      z
        .object({
          subject: z.string().min(1).max(128),
          attestation_class: AttestationClassSchema,
          statement_hash: HashSchema,
        })
        .strict(),
    ),
    verification_material: z.object({ key_registry: KeyRegistrySchema }).strict(),
    integrity: z
      .object({
        alg: z.literal("Ed25519"),
        key_id: IdentifierSchema,
        public_key: Base64UrlSchema,
        signature: Base64UrlSchema,
      })
      .strict(),
  })
  .strict();

export type InntrisEvidenceBundleV1 = z.infer<typeof InntrisEvidenceBundleV1Schema>;
