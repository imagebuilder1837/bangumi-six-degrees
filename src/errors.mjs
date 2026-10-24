// Codes carry meaning across modules; messages and causes retain the original reason.
export class OperationError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.code = code;
  }
}
