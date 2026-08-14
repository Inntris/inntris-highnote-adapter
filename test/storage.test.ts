import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileEvidenceSink } from "../src/evidence/index.js";
import { loadMandateSnapshot } from "../src/mandates/index.js";
import { highnoteRequest, signedBody, testProcessor } from "./helpers.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "inntris-highnote-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("reference storage adapters", () => {
  it("writes an evidence bundle once without changing its contents", async () => {
    const directory = await temporaryDirectory();
    const request = highnoteRequest();
    const signed = signedBody(request);
    const result = await (
      await testProcessor()
    ).process({ request, rawBody: signed.rawBody, highnoteSignature: signed.signature });
    const sink = new FileEvidenceSink(directory);
    await sink.write(result.bundle);
    const stored = JSON.parse(
      await readFile(path.join(directory, `${result.bundle.bundle_id}.json`), "utf8"),
    ) as unknown;
    expect(stored).toEqual(result.bundle);
    await expect(sink.listRecent({ provider: "highnote", limit: 10 })).resolves.toEqual([
      result.bundle,
    ]);
    await expect(sink.findByDecisionId(result.decision.decision_id)).resolves.toEqual(
      result.bundle,
    );
    await expect(
      sink.findByHighnoteRequestId(
        result.bundle.execution_reference.collaborative_authorization_request_id,
      ),
    ).resolves.toEqual(result.bundle);
    await expect(sink.write(result.bundle)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("loads a valid mandate snapshot and fails closed for missing or invalid data", async () => {
    const directory = await temporaryDirectory();
    const validPath = path.join(directory, "valid.json");
    const invalidPath = path.join(directory, "invalid.json");
    await writeFile(
      validPath,
      await readFile(new URL("../config/mandates.test.json", import.meta.url), "utf8"),
      "utf8",
    );
    await writeFile(invalidPath, "{}", "utf8");
    await expect(loadMandateSnapshot(validPath)).resolves.toBeDefined();
    await expect(loadMandateSnapshot(invalidPath)).rejects.toMatchObject({
      code: "INVALID_MANDATE_SNAPSHOT",
    });
    await expect(loadMandateSnapshot(path.join(directory, "missing.json"))).rejects.toMatchObject({
      code: "MANDATE_SNAPSHOT_UNAVAILABLE",
    });
  });
});
