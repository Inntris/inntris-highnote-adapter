import { readFile } from "node:fs/promises";

import { AdapterError } from "../errors.js";
import { MandateSnapshotSchema, type MandateRecord, type MandateSnapshot } from "./schemas.js";

export interface MandateStore {
  findByPaymentCardId(paymentCardId: string): MandateRecord | undefined;
}

export class SnapshotMandateStore implements MandateStore {
  readonly #byPaymentCardId: ReadonlyMap<string, MandateRecord>;

  constructor(readonly snapshot: MandateSnapshot) {
    const parsed = MandateSnapshotSchema.parse(snapshot);
    this.#byPaymentCardId = new Map(
      parsed.records.map((record) => [record.payment_card_id, record]),
    );
  }

  findByPaymentCardId(paymentCardId: string): MandateRecord | undefined {
    return this.#byPaymentCardId.get(paymentCardId);
  }
}

export async function loadMandateSnapshot(path: string): Promise<SnapshotMandateStore> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new AdapterError(
      "MANDATE_SNAPSHOT_UNAVAILABLE",
      `Unable to load the mandate snapshot from ${path}`,
      503,
    );
  }
  try {
    return new SnapshotMandateStore(MandateSnapshotSchema.parse(JSON.parse(raw)));
  } catch {
    throw new AdapterError("INVALID_MANDATE_SNAPSHOT", "Mandate snapshot validation failed", 503);
  }
}
