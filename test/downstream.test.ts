import { createServer, type RequestListener, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpDownstreamAuthorisationClient } from "../src/adapter/index.js";

const servers: Server[] = [];

async function listen(handler: RequestListener): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  return new URL(`http://127.0.0.1:${address.port}/authorize`);
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("downstream collaborative authorization client", () => {
  it("forwards the exact body and signature", async () => {
    const rawBody = Buffer.from('{"synthetic":true}', "utf8");
    let resolveReceived!: (value: { body: string; signature: string | undefined }) => void;
    const received = new Promise<{ body: string; signature: string | undefined }>((resolve) => {
      resolveReceived = resolve;
    });
    const url = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        resolveReceived({
          body: Buffer.concat(chunks).toString("utf8"),
          signature: request.headers["highnote-signature"] as string | undefined,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"transaction":{"id":"tx_1"},"responseCode":"APPROVED"}');
      });
    });
    const client = new HttpDownstreamAuthorisationClient(url, 500, "deny");
    await expect(
      client.authorise({ rawBody, highnoteSignature: "fixture-signature", transactionId: "tx_1" }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(received).resolves.toEqual({
      body: rawBody.toString("utf8"),
      signature: "fixture-signature",
    });
  });

  it.each([
    ["unparseable body", "not json at all"],
    ["schema violation", '{"transaction":{"id":"tx_1"},"responseCode":"NOT_A_CODE"}'],
    ["transaction mismatch", '{"transaction":{"id":"tx_other"},"responseCode":"APPROVED"}'],
    [
      "partial approval without an amount",
      '{"transaction":{"id":"tx_1"},"responseCode":"PARTIAL_AMOUNT_APPROVED"}',
    ],
  ])(
    "denies on a downstream %s even under the advisory failure policy",
    async (_label, downstreamBody) => {
      const url = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(downstreamBody);
      });
      const record = vi.fn();
      // `allow_inntris` is the weakest configuration. A malformed answer must
      // still deny, otherwise a broken endpoint silently becomes an approval.
      const client = new HttpDownstreamAuthorisationClient(url, 500, "allow_inntris", { record });
      await expect(
        client.authorise({
          rawBody: Buffer.from("{}", "utf8"),
          highnoteSignature: "fixture-signature",
          transactionId: "tx_1",
        }),
      ).resolves.toEqual({ allowed: false, responseCode: "INVALID_TRANSACTION" });
      expect(record.mock.calls[0]?.[0]).toBe("protocol_violation");
    },
  );

  it.each([
    ["deny", { allowed: false, responseCode: "INVALID_TRANSACTION" }],
    ["allow_inntris", undefined],
  ] as const)("applies the %s timeout policy", async (failurePolicy, expected) => {
    const url = await listen(() => undefined);
    const record = vi.fn();
    const client = new HttpDownstreamAuthorisationClient(url, 20, failurePolicy, { record });
    const result = await client.authorise({
      rawBody: Buffer.from("{}", "utf8"),
      highnoteSignature: "fixture-signature",
      transactionId: "tx_1",
    });
    expect(result).toEqual(expected);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toBe(
      failurePolicy === "deny" ? "failure_fail_closed" : "failure_fail_open",
    );
  });
});
