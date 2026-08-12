import { performance } from "node:perf_hooks";

import { highnoteRequest, signedBody, testProcessor } from "../test/helpers.js";

const iterations = Number(process.argv[2] ?? "200");
if (!Number.isSafeInteger(iterations) || iterations < 10 || iterations > 10_000) {
  throw new TypeError("Iteration count must be an integer from 10 to 10000");
}

const processor = await testProcessor();
const durations: number[] = [];
for (let index = 0; index < iterations; index += 1) {
  const suffix = String(index).padStart(5, "0");
  const request = highnoteRequest({
    requestId: `te_benchmark_${suffix}`,
    transactionId: `tx_benchmark_${suffix}`,
  });
  const signed = signedBody(request);
  const started = performance.now();
  await processor.process({
    request,
    rawBody: signed.rawBody,
    highnoteSignature: signed.signature,
  });
  durations.push(performance.now() - started);
}

durations.sort((left, right) => left - right);
function percentile(value: number): number {
  return durations[Math.min(durations.length - 1, Math.ceil(value * durations.length) - 1)]!;
}
const output = {
  iterations,
  p50_ms: Number(percentile(0.5).toFixed(2)),
  p95_ms: Number(percentile(0.95).toFixed(2)),
  p99_ms: Number(percentile(0.99).toFixed(2)),
  max_ms: Number(durations.at(-1)!.toFixed(2)),
  highnote_deadline_ms: 2000,
};
process.stdout.write(`${JSON.stringify(output)}\n`);
if (output.p99_ms >= 1500) process.exitCode = 1;
