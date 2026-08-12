import { readFile } from "node:fs/promises";
import path from "node:path";

import { humanVerificationOutput, verifyDecision } from "../src/contracts/index.js";
import { InntrisEvidenceBundleV1Schema, verifyEvidenceBundle } from "../src/evidence/index.js";

const inputPath = path.resolve(process.argv[2] ?? "fixtures/allow/evidence-bundle.json");
const bundle = InntrisEvidenceBundleV1Schema.parse(
  JSON.parse(await readFile(inputPath, "utf8")) as unknown,
);
const at = new Date(Date.parse(bundle.decision.issued_at) + 1);
const decision = verifyDecision({
  action: bundle.action,
  decision: bundle.decision,
  keyRegistry: bundle.verification_material.key_registry,
  at,
  expectedPolicyVersion: bundle.decision.policy.policy_version,
});
const evidence = verifyEvidenceBundle(bundle, {
  at,
  expectedPolicyVersion: bundle.decision.policy.policy_version,
});

process.stdout.write(`${humanVerificationOutput(decision)}\n`);
process.stdout.write(
  `${evidence.valid ? "PASS" : "FAIL"} evidence bundle signature and exact Highnote binding\n`,
);
process.stdout.write(
  "TRUST: Highnote transaction facts are reported by Highnote and are not independently proven by this pack.\n",
);
if (!decision.valid || !evidence.valid) process.exitCode = 1;
