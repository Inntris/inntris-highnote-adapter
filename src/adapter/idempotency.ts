import { AdapterError } from "../errors.js";

interface Entry<T> {
  payloadHash: string;
  promise: Promise<T>;
  expiresAt: number;
}

export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

export class InMemoryIdempotencyStore {
  readonly #entries = new Map<string, Entry<unknown>>();

  constructor(
    readonly options: {
      maxEntries?: number;
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries <= 0) {
      throw new TypeError("Idempotency maxEntries must be a positive integer");
    }
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new TypeError("Idempotency ttlMs must be a positive integer");
    }
  }

  get maxEntries(): number {
    return this.options.maxEntries ?? 10_000;
  }

  get ttlMs(): number {
    return this.options.ttlMs ?? 600_000;
  }

  #pruneExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }

  async execute<T>(
    key: string,
    payloadHash: string,
    producer: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const now = (this.options.now ?? Date.now)();
    this.#pruneExpired(now);
    const existing = this.#entries.get(key) as Entry<T> | undefined;
    if (existing !== undefined) {
      if (existing.payloadHash !== payloadHash) {
        throw new AdapterError(
          "IDEMPOTENCY_CONFLICT",
          "The Highnote request id was reused with an altered payload",
          409,
        );
      }
      return { value: await existing.promise, replayed: true };
    }

    if (this.#entries.size >= this.maxEntries) {
      throw new AdapterError(
        "IDEMPOTENCY_CAPACITY_EXCEEDED",
        "The in-memory idempotency store is at capacity",
        503,
      );
    }
    const promise = producer();
    const entry = { payloadHash, promise, expiresAt: now + this.ttlMs };
    this.#entries.set(key, entry);
    try {
      return { value: await promise, replayed: false };
    } catch (error) {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
      throw error;
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
