import { readFile } from "node:fs/promises";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { KeyRegistrySchema, publicKeyFingerprint } from "../src/contracts/index.js";
import {
  buildOfflineEvidencePack,
  verifyEvidenceBundle,
  type InntrisEvidenceBundleV1,
} from "../src/evidence/index.js";
import { FIXED_NOW, highnoteRequest, signedBody, signer, testProcessor } from "./helpers.js";

async function validBundle() {
  const request = highnoteRequest();
  const { rawBody, signature } = signedBody(request);
  return (await (await testProcessor()).process({ request, rawBody, highnoteSignature: signature }))
    .bundle;
}

describe("portable Highnote evidence", () => {
  it("verifies the original bundle offline", async () => {
    const result = verifyEvidenceBundle(await validBundle(), {
      at: FIXED_NOW,
      expectedPolicyVersion: "1",
    });
    expect(result.valid).toBe(true);
    expect(result.trust_summary.highnote_transaction_fact).toContain("reported by Highnote");
  });

  type Mutator = (bundle: InntrisEvidenceBundleV1) => void;

  it.each<[string, Mutator]>([
    ["amount", (bundle) => void (bundle.action.transaction.amount = "51.00")],
    ["merchant", (bundle) => void (bundle.action.transaction.payee = "merchant_changed")],
    [
      "policy hash",
      (bundle) => void (bundle.decision.policy.policy_hash = `sha256:${"0".repeat(64)}`),
    ],
    ["action hash", (bundle) => void (bundle.decision.action_hash = `sha256:${"0".repeat(64)}`)],
    [
      "Highnote reference",
      (bundle) => void (bundle.execution_reference.transaction_id = "tx_changed"),
    ],
    [
      "signature",
      (bundle) => void (bundle.integrity.signature = `${bundle.integrity.signature.slice(0, -1)}A`),
    ],
  ])("fails when %s is changed", async (_name, mutate) => {
    const bundle = structuredClone(await validBundle());
    mutate(bundle);
    expect(verifyEvidenceBundle(bundle, { at: FIXED_NOW }).valid).toBe(false);
  });

  it("creates a deterministic inntris verify compatible evidence pack", async () => {
    const bundle = await validBundle();
    const first = await buildOfflineEvidencePack({ bundle, signer });
    const second = await buildOfflineEvidencePack({ bundle, signer });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const entries = unzipSync(first);
    expect(Object.keys(entries).sort()).toEqual([
      "evidence/bundle.json",
      "keys/registry.json",
      "manifest.json",
      "manifest.sig.json",
      "verification/TRUST_BOUNDARY.txt",
    ]);
    expect(JSON.parse(Buffer.from(entries["manifest.json"]!).toString("utf8"))).toHaveProperty(
      "version",
      "inntris-evidence-pack-v1",
    );
  });

  it.each([
    ["ALLOW", {}],
    ["BLOCK", { amount: 25_000, requestId: "te_block_001", transactionId: "tx_block_001" }],
  ] as const)("creates deterministic %s evidence", async (_label, overrides) => {
    const request = highnoteRequest(overrides);
    const signed = signedBody(request);
    const first = await (
      await testProcessor()
    ).process({ request, rawBody: signed.rawBody, highnoteSignature: signed.signature });
    const second = await (
      await testProcessor()
    ).process({ request, rawBody: signed.rawBody, highnoteSignature: signed.signature });
    expect(second.bundle).toEqual(first.bundle);
  });

  it("ships a pinned upstream key registry that parses under the shared schema", async () => {
    const registry = KeyRegistrySchema.parse(
      JSON.parse(
        await readFile(
          new URL("../fixtures/x402/upstream/key-registry.json", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
    expect(registry.keys).not.toHaveLength(0);
    for (const key of registry.keys) {
      expect(publicKeyFingerprint(Buffer.from(key.public_key, "base64url"))).toBe(key.fingerprint);
    }
  });
});
