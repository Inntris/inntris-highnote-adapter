import Fastify, { type FastifyInstance } from "fastify";

import type { Clock } from "./contracts/index.js";
import { AdapterError } from "./errors.js";
import type { EvidenceSink } from "./evidence/index.js";
import {
  CollaborativeAuthorizationRequestSchema,
  verifyHighnoteAuthenticity,
  verifyHighnoteFreshness,
  type SignatureEncoding,
} from "./highnote/index.js";
import { AdapterMetrics } from "./metrics.js";
import type { HighnoteAuthorisationProcessor } from "./adapter/processor.js";

declare module "fastify" {
  interface FastifyRequest {
    rawJsonBody?: Buffer;
  }
}

export function buildApp(input: {
  processor: HighnoteAuthorisationProcessor;
  evidenceSink: EvidenceSink;
  clock: Clock;
  signingSecrets: string[];
  signatureEncoding: SignatureEncoding;
  maxSignatureAgeMs: number;
  maxFutureSkewMs: number;
  metrics?: AdapterMetrics;
  logger?: boolean | { level: string; redact?: string[] };
}): FastifyInstance {
  const metrics = input.metrics ?? new AdapterMetrics(false);
  const app = Fastify({
    logger:
      input.logger ??
      ({
        level: "info",
        redact: [
          "req.headers.highnote-signature",
          "req.headers.authorization",
          "req.body",
          "res.body",
        ],
      } as const),
    bodyLimit: 256 * 1024,
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      try {
        request.rawJsonBody = Buffer.from(body);
        done(null, JSON.parse(body.toString("utf8")) as unknown);
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", () => ({ status: "ready" }));
  app.get("/metrics", (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.post("/v1/highnote/collaborative-authorization", async (request, reply) => {
    const started = performance.now();
    const rawBody = request.rawJsonBody;
    if (rawBody === undefined) {
      throw new AdapterError("MISSING_RAW_BODY", "Missing JSON request body", 400);
    }
    const signatureValue = request.headers["highnote-signature"];
    const signatureHeader = Array.isArray(signatureValue) ? signatureValue[0] : signatureValue;
    try {
      verifyHighnoteAuthenticity({
        rawBody,
        signatureHeader,
        signingSecrets: input.signingSecrets,
        signatureEncoding: input.signatureEncoding,
      });
      const parsed = CollaborativeAuthorizationRequestSchema.parse(request.body);
      verifyHighnoteFreshness({
        signatureTimestamp: parsed.extensions.signatureTimestamp,
        now: input.clock.now(),
        maxAgeMs: input.maxSignatureAgeMs,
        maxFutureSkewMs: input.maxFutureSkewMs,
      });
      metrics.highnoteRequestVerificationTotal.inc({ result: "valid" });
      const processed = await input.processor.process({
        request: parsed,
        rawBody,
        highnoteSignature: signatureHeader ?? "",
      });
      metrics.requestsTotal.inc({ result: processed.response.responseCode });
      metrics.policyDecisionTotal.inc({ verdict: processed.decision.verdict });
      if (processed.replayed) metrics.replayAttemptTotal.inc();
      if (!processed.replayed) {
        setImmediate(() => {
          void input.evidenceSink
            .write(processed.bundle)
            .then(() => metrics.evidenceEmitTotal.inc({ result: "success" }))
            .catch((error: unknown) => {
              metrics.evidenceEmitTotal.inc({ result: "failure" });
              request.log.error(
                { err: error, bundle_id: processed.bundle.bundle_id },
                "Evidence emission failed",
              );
            });
        });
      }
      const latencyMs = performance.now() - started;
      metrics.decisionLatencyMs.observe({ result: processed.response.responseCode }, latencyMs);
      request.log.info(
        {
          request_id: parsed.data.collaborativeAuthorizationRequest.id,
          decision_id: processed.decision.decision_id,
          action_hash: processed.decision.action_hash,
          verdict: processed.decision.verdict,
          response_code: processed.response.responseCode,
          latency_ms: latencyMs,
          replayed: processed.replayed,
          freshness: "valid",
          downstream_outcome: processed.downstreamOutcome,
        },
        "Collaborative authorization decided",
      );
      reply.code(200);
      return processed.response;
    } catch (error) {
      metrics.highnoteRequestVerificationTotal.inc({
        result: error instanceof AdapterError ? error.code : "invalid",
      });
      metrics.decisionLatencyMs.observe({ result: "error" }, performance.now() - started);
      throw error;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AdapterError) {
      request.log.warn({ error_code: error.code }, error.message);
      void reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
      return;
    }
    if ((error as { name?: string }).name === "ZodError") {
      request.log.warn(
        { error_code: "INVALID_REQUEST_SCHEMA" },
        "Request schema validation failed",
      );
      void reply.code(400).send({
        error: { code: "INVALID_REQUEST_SCHEMA", message: "Request schema validation failed" },
      });
      return;
    }
    request.log.error({ err: error }, "Unhandled adapter failure");
    void reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
  });

  return app;
}
