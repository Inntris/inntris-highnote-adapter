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
