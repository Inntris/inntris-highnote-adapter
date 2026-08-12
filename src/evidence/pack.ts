import { zipSync, strToU8 } from "fflate";

import {
  canonicalBytes,
  canonicalise,
  sha256Bytes,
  type SigningProvider,
} from "../contracts/index.js";
import type { InntrisEvidenceBundleV1 } from "./schemas.js";

function hexDigest(bytes: Uint8Array): string {
  return sha256Bytes(bytes).slice("sha256:".length);
}

export async function buildOfflineEvidencePack(input: {
  bundle: InntrisEvidenceBundleV1;
  signer: SigningProvider;
}): Promise<Uint8Array> {
  const bundleBytes = canonicalBytes(input.bundle);
  const registryBytes = canonicalBytes(input.bundle.verification_material.key_registry);
  const explanationBytes = strToU8(
    "This pack proves Inntris decision and captured evidence integrity. Highnote transaction facts remain Highnote-reported facts.\n",
  );
  const files: Record<string, Uint8Array> = {
    "evidence/bundle.json": bundleBytes,
    "keys/registry.json": registryBytes,
    "verification/TRUST_BOUNDARY.txt": explanationBytes,
  };
  const manifest = {
    version: "inntris-evidence-pack-v1",
    profile: "highnote-reference-adapter",
    files: Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, contents]) => ({
        path,
        sha256: hexDigest(contents),
        size_bytes: contents.byteLength,
      })),
  };
  const manifestBytes = canonicalBytes(manifest);
  const signature = await input.signer.sign(manifestBytes);
  const signatureBody = {
    manifest_sha256: hexDigest(manifestBytes),
    public_key_b64: Buffer.from(input.signer.publicKey).toString("base64"),
    signature_b64: Buffer.from(signature, "base64url").toString("base64"),
  };
  const archiveEntries: Record<string, Uint8Array> = {
    ...files,
    "manifest.json": manifestBytes,
    "manifest.sig.json": strToU8(canonicalise(signatureBody)),
  };
  return zipSync(archiveEntries, {
    level: 9,
    // ZIP stores a timezone-free DOS timestamp. Constructing the same local
    // calendar time avoids environment-dependent bytes across CI and Windows.
    mtime: new Date(1980, 0, 1, 0, 0, 0),
  });
}
