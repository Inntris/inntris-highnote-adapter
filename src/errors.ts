/**
 * How a failure raised after a Highnote request has been authenticated is
 * surfaced to Highnote.
 *
 * `decline` returns an explicit 2xx decline so the adapter stays an
 * enforcement control. `stand_in` returns the underlying non-2xx status and
 * therefore hands the outcome to the Highnote card product stand-in setting,
 * which may be configured to approve.
 */
export type AuthorizationFailurePolicy = "decline" | "stand_in";

export class AdapterError extends Error {
  override readonly name = "AdapterError";

  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
