import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalise, type Verdict } from "../contracts/index.js";
import { InntrisEvidenceBundleV1Schema, type InntrisEvidenceBundleV1 } from "./schemas.js";

export interface EvidenceSink {
  write(bundle: InntrisEvidenceBundleV1): Promise<void>;
}

export interface EvidenceListOptions {
  verdict?: Verdict;
  provider?: "highnote";
  limit: number;
}

export interface EvidenceRepository extends EvidenceSink {
  listRecent(options: EvidenceListOptions): Promise<InntrisEvidenceBundleV1[]>;
  findByDecisionId(decisionId: string): Promise<InntrisEvidenceBundleV1 | undefined>;
  findByHighnoteRequestId(requestId: string): Promise<InntrisEvidenceBundleV1 | undefined>;
}

function newestFirst(bundles: InntrisEvidenceBundleV1[]): InntrisEvidenceBundleV1[] {
  return [...bundles].sort(
    (left, right) => Date.parse(right.decision.issued_at) - Date.parse(left.decision.issued_at),
  );
}

function listFrom(
  bundles: InntrisEvidenceBundleV1[],
  options: EvidenceListOptions,
): InntrisEvidenceBundleV1[] {
  const safeLimit = Math.min(Math.max(Math.trunc(options.limit), 0), 100);
  return newestFirst(bundles)
    .filter(
      (bundle) =>
        (options.verdict === undefined || bundle.decision.verdict === options.verdict) &&
        (options.provider === undefined ||
          bundle.execution_reference.provider === options.provider),
    )
    .slice(0, safeLimit);
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class FileEvidenceSink implements EvidenceRepository {
  constructor(readonly directory: string) {}

  async write(bundle: InntrisEvidenceBundleV1): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const safeId = bundle.bundle_id.replace(/[^A-Za-z0-9._-]/gu, "_");
    await writeFile(path.join(this.directory, `${safeId}.json`), `${canonicalise(bundle)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  async listRecent(options: EvidenceListOptions): Promise<InntrisEvidenceBundleV1[]> {
    return listFrom(await this.readAll(), options);
  }

  async findByDecisionId(decisionId: string): Promise<InntrisEvidenceBundleV1 | undefined> {
    return newestFirst(await this.readAll()).find(
      (bundle) => bundle.decision.decision_id === decisionId,
    );
  }

  async findByHighnoteRequestId(requestId: string): Promise<InntrisEvidenceBundleV1 | undefined> {
    return newestFirst(await this.readAll()).find(
      (bundle) => bundle.execution_reference.collaborative_authorization_request_id === requestId,
    );
  }

  private async readAll(): Promise<InntrisEvidenceBundleV1[]> {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingDirectory(error)) return [];
      throw error;
    }
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) =>
          InntrisEvidenceBundleV1Schema.parse(
            JSON.parse(await readFile(path.join(this.directory, entry.name), "utf8")) as unknown,
          ),
        ),
    );
  }
}

export class CollectingEvidenceSink implements EvidenceRepository {
  readonly bundles: InntrisEvidenceBundleV1[] = [];

  write(bundle: InntrisEvidenceBundleV1): Promise<void> {
    this.bundles.push(bundle);
    return Promise.resolve();
  }

  listRecent(options: EvidenceListOptions): Promise<InntrisEvidenceBundleV1[]> {
    return Promise.resolve(listFrom(this.bundles, options));
  }

  findByDecisionId(decisionId: string): Promise<InntrisEvidenceBundleV1 | undefined> {
    return Promise.resolve(
      newestFirst(this.bundles).find((bundle) => bundle.decision.decision_id === decisionId),
    );
  }

  findByHighnoteRequestId(requestId: string): Promise<InntrisEvidenceBundleV1 | undefined> {
    return Promise.resolve(
      newestFirst(this.bundles).find(
        (bundle) => bundle.execution_reference.collaborative_authorization_request_id === requestId,
      ),
    );
  }
}
