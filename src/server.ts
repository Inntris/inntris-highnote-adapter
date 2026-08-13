import { pathToFileURL } from "node:url";

import { buildApp } from "./app.js";
import {
  HighnoteAuthorisationProcessor,
  HttpDownstreamAuthorisationClient,
  InMemoryIdempotencyStore,
} from "./adapter/index.js";
import { loadConfig } from "./config.js";
import { Ed25519SigningProvider, systemClock } from "./contracts/index.js";
import { FileEvidenceSink } from "./evidence/index.js";
import { loadMandateSnapshot } from "./mandates/index.js";
import { AdapterMetrics } from "./metrics.js";

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const signer = Ed25519SigningProvider.fromBase64UrlSeed(
    config.signingKeyId,
    config.signingSeedBase64Url,
  );
  const mandateStore = await loadMandateSnapshot(config.mandateSnapshotPath);
  const metrics = new AdapterMetrics();
  const downstreamClient =
    config.downstreamUrl === undefined
      ? undefined
      : new HttpDownstreamAuthorisationClient(
          config.downstreamUrl,
          config.downstreamTimeoutMs,
          config.downstreamFailurePolicy,
          {
            record(result, latencyMs): void {
              metrics.downstreamProxyTotal.inc({ result });
              metrics.downstreamLatencyMs.observe({ result }, latencyMs);
            },
          },
        );
  const processor = new HighnoteAuthorisationProcessor({
    mandateStore,
    signer,
    clock: systemClock,
    actionResource: config.publicAdapterUrl,
    idempotencyStore: new InMemoryIdempotencyStore({
      maxEntries: config.idempotencyMaxEntries,
      ttlMs: config.idempotencyTtlMs,
    }),
    ...(downstreamClient === undefined ? {} : { downstreamClient }),
  });
  const app = buildApp({
    processor,
    evidenceSink: new FileEvidenceSink(config.evidenceOutputDirectory),
    clock: systemClock,
    signingSecrets: config.highnoteSigningSecrets,
    signatureEncoding: config.signatureEncoding,
    maxSignatureAgeMs: config.maxSignatureAgeMs,
    maxFutureSkewMs: config.maxFutureSkewMs,
    authorizationFailurePolicy: config.authorizationFailurePolicy,
    metrics,
    logger: { level: config.logLevel },
  });
  const close = async (): Promise<void> => {
    await app.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await startServer();
}
