import { describe, expect, it, vi } from "vitest";

import { InMemoryIdempotencyStore } from "../src/adapter/index.js";

describe("idempotency and replay", () => {
  it("returns a stable result for an exact retry", async () => {
    const store = new InMemoryIdempotencyStore();
    const producer = vi.fn(() => Promise.resolve({ verdict: "ALLOW" }));
    const first = await store.execute("te_1", "hash-a", producer);
    const retry = await store.execute("te_1", "hash-a", producer);
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.value).toEqual(first.value);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent duplicate delivery", async () => {
    const store = new InMemoryIdempotencyStore();
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = store.execute("te_1", "hash-a", () => pending);
    const duplicate = store.execute("te_1", "hash-a", () => Promise.resolve("wrong"));
    release("stable");
    await expect(first).resolves.toMatchObject({ value: "stable", replayed: false });
    await expect(duplicate).resolves.toMatchObject({ value: "stable", replayed: true });
  });

  it("rejects an altered payload with the same request id", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.execute("te_1", "hash-a", () => Promise.resolve("stable"));
    await expect(
      store.execute("te_1", "hash-b", () => Promise.resolve("altered")),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("does not cache producer failures", async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(
      store.execute("te_1", "hash-a", () => Promise.reject(new Error("fail"))),
    ).rejects.toThrow("fail");
    await expect(
      store.execute("te_1", "hash-a", () => Promise.resolve("retry")),
    ).resolves.toMatchObject({ value: "retry", replayed: false });
  });

  it("bounds memory and permits reuse after expiry", async () => {
    let now = 1_000;
    const store = new InMemoryIdempotencyStore({ maxEntries: 1, ttlMs: 100, now: () => now });
    await store.execute("te_1", "hash-a", () => Promise.resolve("first"));
    await expect(
      store.execute("te_2", "hash-b", () => Promise.resolve("second")),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CAPACITY_EXCEEDED" });
    now += 101;
    await expect(
      store.execute("te_2", "hash-b", () => Promise.resolve("second")),
    ).resolves.toMatchObject({ value: "second", replayed: false });
  });
});
