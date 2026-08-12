import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AdapterError } from "../src/errors.js";
import { canonicalise } from "../src/contracts/index.js";
import { buildOfflineEvidencePack, type InntrisEvidenceBundleV1 } from "../src/evidence/index.js";
import {
  FIXED_NOW,
  highnoteRequest,
  signedBody,
  signer,
  testMandateStore,
  testProcessor,
} from "../test/helpers.js";

const fixtureRoot = path.resolve("fixtures");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${canonicalise(value)}\n`, "utf8");
}

async function generateCase(
  name: "allow" | "block" | "approval",
  request: ReturnType<typeof highnoteRequest>,
): Promise<InntrisEvidenceBundleV1> {
  const directory = path.join(fixtureRoot, name);
  await mkdir(directory, { recursive: true });
  const { rawBody, signature } = signedBody(request);
  const result = await (
    await testProcessor()
  ).process({
    request,
    rawBody,
    highnoteSignature: signature,
  });
  await writeFile(path.join(directory, "request.json"), rawBody);
  await writeFile(path.join(directory, "highnote-signature.txt"), `${signature}\n`, "utf8");
  await writeJson(path.join(directory, "response.json"), result.response);
  await writeJson(path.join(directory, "action.json"), result.bundle.action);
  await writeJson(path.join(directory, "decision.json"), result.decision);
  await writeJson(path.join(directory, "evidence-bundle.json"), result.bundle);
  await writeJson(path.join(directory, "evidence.json"), result.bundle);
  const mandate = (await testMandateStore()).findByPaymentCardId(
    request.data.collaborativeAuthorizationRequest.paymentCard.id,
  );
  if (mandate === undefined) throw new Error("Fixture mandate is missing");
  await writeJson(path.join(directory, "policy.json"), mandate.policy);
  await writeJson(
    path.join(directory, "key-registry.json"),
    result.bundle.verification_material.key_registry,
  );
  await writeFile(
    path.join(directory, "public-key.txt"),
    `${Buffer.from(signer.publicKey).toString("base64")}\n`,
    "utf8",
  );
  await writeFile(
    path.join(directory, "evidence-pack.zip"),
    await buildOfflineEvidencePack({ bundle: result.bundle, signer }),
  );
  return result.bundle;
}

const allowBundle = await generateCase("allow", highnoteRequest());
await generateCase(
  "block",
  highnoteRequest({ requestId: "te_block_001", transactionId: "tx_block_001", amount: 25_000 }),
);
await generateCase(
  "approval",
  highnoteRequest({
    requestId: "te_approval_001",
    transactionId: "tx_approval_001",
    paymentCardId: "card_approval_001",
  }),
);

const replayDirectory = path.join(fixtureRoot, "replay");
await mkdir(replayDirectory, { recursive: true });
const replayProcessor = await testProcessor();
const replayRequest = highnoteRequest({
  requestId: "te_replay_001",
  transactionId: "tx_replay_001",
});
const replaySigned = signedBody(replayRequest);
const first = await replayProcessor.process({
  request: replayRequest,
  rawBody: replaySigned.rawBody,
  highnoteSignature: replaySigned.signature,
});
const retry = await replayProcessor.process({
  request: replayRequest,
  rawBody: replaySigned.rawBody,
  highnoteSignature: replaySigned.signature,
});
const altered = highnoteRequest({
  requestId: "te_replay_001",
  transactionId: "tx_replay_001",
  amount: 5001,
});
const alteredSigned = signedBody(altered);
let alteredResult: { error_code: string };
try {
  await replayProcessor.process({
    request: altered,
    rawBody: alteredSigned.rawBody,
    highnoteSignature: alteredSigned.signature,
  });
  throw new Error("Altered replay unexpectedly succeeded");
} catch (error: unknown) {
  if (!(error instanceof AdapterError)) throw error;
  alteredResult = { error_code: error.code };
}
await writeJson(path.join(replayDirectory, "first-response.json"), first.response);
await writeJson(path.join(replayDirectory, "duplicate-request.json"), replayRequest);
await writeJson(path.join(replayDirectory, "retry-result.json"), {
  replayed: retry.replayed,
  response: retry.response,
});
await writeJson(path.join(replayDirectory, "altered-request.json"), altered);
await writeJson(path.join(replayDirectory, "altered-payload-same-id.json"), altered);
await writeJson(path.join(replayDirectory, "altered-result.json"), alteredResult);
await writeJson(
  path.join(replayDirectory, "stale-request.json"),
  highnoteRequest({
    requestId: "te_stale_001",
    transactionId: "tx_stale_001",
    signatureTimestamp: FIXED_NOW.getTime() - 300_001,
  }),
);

const tamperDirectory = path.join(fixtureRoot, "tamper");
await mkdir(tamperDirectory, { recursive: true });
const tamperCases: Record<string, InntrisEvidenceBundleV1> = {
  "changed-action-hash.json": structuredClone(allowBundle),
  "changed-amount.json": structuredClone(allowBundle),
  "changed-merchant.json": structuredClone(allowBundle),
  "changed-policy-hash.json": structuredClone(allowBundle),
  "changed-highnote-reference.json": structuredClone(allowBundle),
  "changed-signature.json": structuredClone(allowBundle),
};
tamperCases["changed-action-hash.json"]!.decision.action_hash = `sha256:${"0".repeat(64)}`;
tamperCases["changed-amount.json"]!.action.transaction.amount = "51.00";
tamperCases["changed-merchant.json"]!.action.transaction.payee = "merchant_changed";
tamperCases["changed-policy-hash.json"]!.decision.policy.policy_hash = `sha256:${"0".repeat(64)}`;
tamperCases["changed-highnote-reference.json"]!.execution_reference.transaction_id = "tx_changed";
const originalSignature = tamperCases["changed-signature.json"]!.integrity.signature;
tamperCases["changed-signature.json"]!.integrity.signature =
  `${originalSignature[0] === "A" ? "B" : "A"}${originalSignature.slice(1)}`;
for (const [name, bundle] of Object.entries(tamperCases)) {
  await writeJson(path.join(tamperDirectory, name), bundle);
}

process.stdout.write(`Generated fixtures in ${fixtureRoot}\n`);
