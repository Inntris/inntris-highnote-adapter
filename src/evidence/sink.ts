import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalise } from "../contracts/index.js";
import type { InntrisEvidenceBundleV1 } from "./schemas.js";

export interface EvidenceSink {
  write(bundle: InntrisEvidenceBundleV1): Promise<void>;
}

export class FileEvidenceSink implements EvidenceSink {
  constructor(readonly directory: string) {}

  async write(bundle: InntrisEvidenceBundleV1): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const safeId = bundle.bundle_id.replace(/[^A-Za-z0-9._-]/gu, "_");
    await writeFile(path.join(this.directory, `${safeId}.json`), `${canonicalise(bundle)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export class CollectingEvidenceSink implements EvidenceSink {
  readonly bundles: InntrisEvidenceBundleV1[] = [];

  write(bundle: InntrisEvidenceBundleV1): Promise<void> {
    this.bundles.push(bundle);
    return Promise.resolve();
  }
}
