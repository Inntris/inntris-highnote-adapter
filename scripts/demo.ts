import { verifyDecision } from "../src/contracts/index.js";
import { verifyEvidenceBundle } from "../src/evidence/index.js";
import { highnoteRequest, signedBody, testProcessor } from "../test/helpers.js";

async function runCase(label: string, request: ReturnType<typeof highnoteRequest>): Promise<void> {
  const processor = await testProcessor();
  const { rawBody, signature } = signedBody(request);
  const result = await processor.process({
    request,
    rawBody,
    highnoteSignature: signature,
  });
  const verificationAt = new Date(Date.parse(result.decision.issued_at) + 1);
  const decisionCheck = verifyDecision({
    action: result.bundle.action,
    decision: result.decision,
    keyRegistry: result.bundle.verification_material.key_registry,
    at: verificationAt,
    expectedPolicyVersion: "1",
  });
  const evidenceCheck = verifyEvidenceBundle(result.bundle, {
    at: verificationAt,
    expectedPolicyVersion: "1",
  });
  process.stdout.write(
    `${JSON.stringify({
      case: label,
      highnote_response: result.response.responseCode,
      inntris_verdict: result.decision.verdict,
      signed_decision_valid: decisionCheck.valid,
      evidence_valid: evidenceCheck.valid,
      replayed: result.replayed,
    })}\n`,
  );
}

await runCase("ALLOW", highnoteRequest());
await runCase(
  "BLOCK",
  highnoteRequest({ requestId: "te_block_001", transactionId: "tx_block_001", amount: 25_000 }),
);
await runCase(
  "REQUIRE_APPROVAL",
  highnoteRequest({
    requestId: "te_approval_001",
    transactionId: "tx_approval_001",
    paymentCardId: "card_approval_001",
  }),
);

const replayProcessor = await testProcessor();
const replayRequest = highnoteRequest({
  requestId: "te_replay_001",
  transactionId: "tx_replay_001",
});
const replaySigned = signedBody(replayRequest);
await replayProcessor.process({
  request: replayRequest,
  rawBody: replaySigned.rawBody,
  highnoteSignature: replaySigned.signature,
});
const replay = await replayProcessor.process({
  request: replayRequest,
  rawBody: replaySigned.rawBody,
  highnoteSignature: replaySigned.signature,
});
process.stdout.write(
  `${JSON.stringify({ case: "REPLAY", response: replay.response.responseCode, replayed: replay.replayed })}\n`,
);
