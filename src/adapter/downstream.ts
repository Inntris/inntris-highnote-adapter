import { outcomeFromResponse, type AuthorisationOutcome } from "./composition.js";

export type DownstreamFailurePolicy = "deny" | "allow_inntris";
export type DownstreamResult =
  | "allow"
  | "deny"
  | "protocol_violation"
  | "failure_fail_open"
  | "failure_fail_closed";

export interface DownstreamObserver {
  record(result: DownstreamResult, latencyMs: number): void;
}

export interface DownstreamAuthorisationClient {
  authorise(input: {
    rawBody: Uint8Array;
    highnoteSignature: string;
    transactionId: string;
  }): Promise<AuthorisationOutcome | undefined>;
}

export class HttpDownstreamAuthorisationClient implements DownstreamAuthorisationClient {
  constructor(
    readonly url: URL,
    readonly timeoutMs: number,
    readonly failurePolicy: DownstreamFailurePolicy,
    readonly observer?: DownstreamObserver,
  ) {}

  async authorise(input: {
    rawBody: Uint8Array;
    highnoteSignature: string;
    transactionId: string;
  }): Promise<AuthorisationOutcome | undefined> {
    const started = performance.now();
    let body: string;
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "HighnotePlatform/1.0.0",
          "highnote-signature": input.highnoteSignature,
          "x-inntris-forwarded": "true",
        },
        body: Buffer.from(input.rawBody),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new TypeError(`Downstream returned HTTP ${response.status}`);
      body = await response.text();
    } catch {
      // The endpoint did not answer: timeout, transport error, non-2xx status
      // or an unreadable stream. Availability failures follow the configured
      // failure policy.
      if (this.failurePolicy === "allow_inntris") {
        this.observer?.record("failure_fail_open", performance.now() - started);
        return undefined;
      }
      this.observer?.record("failure_fail_closed", performance.now() - started);
      return { allowed: false, responseCode: "INVALID_TRANSACTION" };
    }
    try {
      const outcome = outcomeFromResponse(JSON.parse(body) as unknown, input.transactionId);
      this.observer?.record(outcome.allowed ? "allow" : "deny", performance.now() - started);
      return outcome;
    } catch {
      // The endpoint answered, but the answer is not a usable authorisation:
      // unparseable body, schema violation, transaction mismatch or a partial
      // approval with no amount. A malformed response must never become an
      // allow, so this denies under every failure policy.
      this.observer?.record("protocol_violation", performance.now() - started);
      return { allowed: false, responseCode: "INVALID_TRANSACTION" };
    }
  }
}
