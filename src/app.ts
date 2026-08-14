import Fastify, { type FastifyInstance } from "fastify";

import type { Clock } from "./contracts/index.js";
import { registerInntrisDecisionRoutes } from "./decisions/index.js";
import { AdapterError, type AuthorizationFailurePolicy } from "./errors.js";
import type { EvidenceRepository } from "./evidence/index.js";
import {
  CollaborativeAuthorizationRequestSchema,
  countSchemaIssues,
  highnoteRequestIdFrom,
  HighnoteEndpointPingSchema,
  summariseSchemaIssues,
  verifyHighnoteAuthenticity,
  verifyHighnoteFreshness,
  type CollaborativeAuthorizationRequest,
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
  evidenceSink: EvidenceRepository;
  clock: Clock;
  signingSecrets: string[];
  signatureEncoding: SignatureEncoding;
  maxSignatureAgeMs: number;
  maxFutureSkewMs: number;
  authorizationFailurePolicy?: AuthorizationFailurePolicy;
  metrics?: AdapterMetrics;
  logger?: boolean | { level: string; redact?: string[] };
}): FastifyInstance {
  const authorizationFailurePolicy = input.authorizationFailurePolicy ?? "decline";
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
      } catch {
        done(new AdapterError("INVALID_JSON", "Request body is not valid JSON", 400));
      }
    },
  );

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", (_request, reply) => {
    // The adapter can only decide when a Highnote signing secret is configured
    // and the pre-warmed mandate snapshot resolved at least one record.
    const ready = input.signingSecrets.length > 0 && input.processor.isReady();
    reply.code(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready" };
  });
  app.get("/metrics", (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  registerInntrisDecisionRoutes(app, input.evidenceSink);

  app.post("/v1/highnote/collaborative-authorization", async (request, reply) => {
    const started = performance.now();
    const rawBody = request.rawJsonBody;
    if (rawBody === undefined) {
      throw new AdapterError("MISSING_RAW_BODY", "Missing JSON request body", 400);
    }
    const signatureValue = request.headers["highnote-signature"];
    const signatureHeader = Array.isArray(signatureValue) ? signatureValue[0] : signatureValue;

    let parsed: CollaborativeAuthorizationRequest;
    try {
      verifyHighnoteAuthenticity({
        rawBody,
        signatureHeader,
        signingSecrets: input.signingSecrets,
        signatureEncoding: input.signatureEncoding,
      });
      // Highnote verifies a registered endpoint with a signed ping probe that
      // carries no authorisation request. It is answered only after the same
      // signature check above and the same freshness window below, and its
      // strict schema cannot match a malformed authorisation request. No
      // mandate is resolved, no decision is signed and no evidence is emitted,
      // because a probe asks no authority question.
      const probe = HighnoteEndpointPingSchema.safeParse(request.body);
      if (probe.success) {
        verifyHighnoteFreshness({
          signatureTimestamp: probe.data.extensions.signatureTimestamp,
          now: input.clock.now(),
          maxAgeMs: input.maxSignatureAgeMs,
          maxFutureSkewMs: input.maxFutureSkewMs,
        });
        metrics.highnoteRequestVerificationTotal.inc({ result: "valid" });
        metrics.requestsTotal.inc({ result: "ping" });
        metrics.decisionLatencyMs.observe({ result: "ping" }, performance.now() - started);
        request.log.info(
          {
            freshness: "valid",
            ping_value_type: typeof probe.data.data.collaborativeAuthorizationRequest.ping,
          },
          "Highnote endpoint verification ping acknowledged",
        );
        reply.code(200);
        return { ping: "ok" };
      }
      parsed = CollaborativeAuthorizationRequestSchema.parse(request.body);
      verifyHighnoteFreshness({
        signatureTimestamp: parsed.extensions.signatureTimestamp,
        now: input.clock.now(),
        maxAgeMs: input.maxSignatureAgeMs,
        maxFutureSkewMs: input.maxFutureSkewMs,
      });
      metrics.highnoteRequestVerificationTotal.inc({ result: "valid" });
    } catch (error) {
      // The request is not provably a fresh, well-formed Highnote request, so
      // there is nothing to decline against. It is rejected with a non-2xx
      // status and counted only as a verification outcome.
      metrics.highnoteRequestVerificationTotal.inc({
        result: error instanceof AdapterError ? error.code : "invalid",
      });
      metrics.requestsTotal.inc({ result: "rejected" });
      metrics.decisionLatencyMs.observe({ result: "error" }, performance.now() - started);
      throw error;
    }

    const highnoteRequest = parsed.data.collaborativeAuthorizationRequest;
    try {
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
          request_id: highnoteRequest.id,
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
      // The request was authenticated, so the outcome is an authorisation
      // outcome rather than a rejection. Returning a non-2xx here hands the
      // decision to the Highnote stand-in setting, so the default policy
      // declines explicitly instead.
      const code = error instanceof AdapterError ? error.code : "INTERNAL_ERROR";
      metrics.authorizationFailureTotal.inc({ code, policy: authorizationFailurePolicy });
      if (authorizationFailurePolicy === "stand_in") {
        metrics.requestsTotal.inc({ result: "rejected" });
        metrics.decisionLatencyMs.observe({ result: "error" }, performance.now() - started);
        request.log.warn(
          { request_id: highnoteRequest.id, error_code: code, freshness: "valid" },
          "Collaborative authorization deferred to Highnote stand-in",
        );
        throw error;
      }
      const response = {
        transaction: { id: highnoteRequest.transaction.id },
        responseCode: "INVALID_TRANSACTION",
      } as const;
      const latencyMs = performance.now() - started;
      metrics.requestsTotal.inc({ result: response.responseCode });
      metrics.decisionLatencyMs.observe({ result: response.responseCode }, latencyMs);
      request.log.warn(
        {
          request_id: highnoteRequest.id,
          error_code: code,
          response_code: response.responseCode,
          latency_ms: latencyMs,
          freshness: "valid",
        },
        "Collaborative authorization declined after an adapter failure",
      );
      reply.code(200);
      return response;
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
    if ((error as { code?: unknown }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      request.log.warn({ error_code: "PAYLOAD_TOO_LARGE" }, "Request body exceeds the size limit");
      void reply.code(413).send({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit" },
      });
      return;
    }
    if ((error as { name?: string }).name === "ZodError") {
      // Sanitised shape metadata only: failing field paths, issue codes,
      // expected categories and unrecognised key names. No request values, no
      // signature material and no payment data reach the log.
      const requestId = highnoteRequestIdFrom(request.body);
      request.log.warn(
        {
          error_code: "INVALID_REQUEST_SCHEMA",
          schema_issue_count: countSchemaIssues(error),
          schema_issues: summariseSchemaIssues(error),
          ...(requestId === undefined ? {} : { request_id: requestId }),
        },
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
