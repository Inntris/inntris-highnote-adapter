import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class AdapterMetrics {
  readonly registry = new Registry();
  readonly requestsTotal: Counter<"result">;
  readonly decisionLatencyMs: Histogram<"result">;
  readonly highnoteRequestVerificationTotal: Counter<"result">;
  readonly policyDecisionTotal: Counter<"verdict">;
  readonly replayAttemptTotal: Counter;
  readonly downstreamProxyTotal: Counter<"result">;
  readonly downstreamLatencyMs: Histogram<"result">;
  readonly evidenceEmitTotal: Counter<"result">;
  readonly authorizationFailureTotal: Counter<"code" | "policy">;
  readonly coreVerifyLatencyMs: Histogram<"status">;
  readonly coreConsumeLatencyMs: Histogram<"status">;
  readonly coreAuthorityTotal: Counter<"verdict" | "consumption">;

  constructor(includeDefaultMetrics = true) {
    if (includeDefaultMetrics) collectDefaultMetrics({ register: this.registry });
    this.requestsTotal = new Counter({
      name: "requests_total",
      help: "Highnote adapter requests by result",
      labelNames: ["result"],
      registers: [this.registry],
    });
    this.decisionLatencyMs = new Histogram({
      name: "decision_latency_ms",
      help: "End to end adapter decision latency in milliseconds",
      labelNames: ["result"],
      buckets: [5, 10, 25, 50, 100, 250, 500, 750, 1000, 1500, 1900],
      registers: [this.registry],
    });
    this.highnoteRequestVerificationTotal = new Counter({
      name: "highnote_request_verification_total",
      help: "Highnote request verification outcomes",
      labelNames: ["result"],
      registers: [this.registry],
    });
    this.policyDecisionTotal = new Counter({
      name: "policy_decision_total",
      help: "Inntris organisational authority decisions",
      labelNames: ["verdict"],
      registers: [this.registry],
    });
    this.replayAttemptTotal = new Counter({
      name: "replay_attempt_total",
      help: "Idempotent retry or replay attempts",
      registers: [this.registry],
    });
    this.downstreamProxyTotal = new Counter({
      name: "downstream_proxy_total",
      help: "Downstream proxy outcomes",
      labelNames: ["result"],
      registers: [this.registry],
    });
    this.downstreamLatencyMs = new Histogram({
      name: "downstream_latency_ms",
      help: "Downstream proxy latency in milliseconds",
      labelNames: ["result"],
      registers: [this.registry],
    });
    this.evidenceEmitTotal = new Counter({
      name: "evidence_emit_total",
      help: "Asynchronous evidence emission outcomes",
      labelNames: ["result"],
      registers: [this.registry],
    });
    this.authorizationFailureTotal = new Counter({
      name: "authorization_failure_total",
      help: "Adapter failures raised after a Highnote request was authenticated",
      labelNames: ["code", "policy"],
      registers: [this.registry],
    });
    this.coreVerifyLatencyMs = new Histogram({
      name: "inntris_core_verify_latency_ms",
      help: "Inntris Core verify request latency in milliseconds",
      labelNames: ["status"],
      buckets: [25, 50, 100, 250, 500, 800, 1000, 1200, 1500],
      registers: [this.registry],
    });
    this.coreConsumeLatencyMs = new Histogram({
      name: "inntris_core_consume_latency_ms",
      help: "Inntris Core verify token consumption latency in milliseconds",
      labelNames: ["status"],
      buckets: [25, 50, 100, 250, 500, 800, 1000, 1200, 1500],
      registers: [this.registry],
    });
    this.coreAuthorityTotal = new Counter({
      name: "inntris_core_authority_total",
      help: "Inntris Core authority outcomes and consumption state",
      labelNames: ["verdict", "consumption"],
      registers: [this.registry],
    });
  }
}
