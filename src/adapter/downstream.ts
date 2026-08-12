import { outcomeFromResponse, type AuthorisationOutcome } from "./composition.js";

export type DownstreamFailurePolicy = "deny" | "allow_inntris";
export type DownstreamResult = "allow" | "deny" | "failure_fail_open" | "failure_fail_closed";

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
      const body: unknown = await response.json();
      const outcome = outcomeFromResponse(body, input.transactionId);
      this.observer?.record(outcome.allowed ? "allow" : "deny", performance.now() - started);
      return outcome;
    } catch {
      if (this.failurePolicy === "allow_inntris") {
        this.observer?.record("failure_fail_open", performance.now() - started);
        return undefined;
      }
      this.observer?.record("failure_fail_closed", performance.now() - started);
      return { allowed: false, responseCode: "INVALID_TRANSACTION" };
    }
  }
}
