// Errors every kernel module throws.
// The one typed error every kernel call throws (0.6 kernel/core/errors.js; contracts common KernelError). Stable lowercase `code`; `hidden_reason` is kept in the log and never shown to the caller.
export class KernelError extends Error {
  code: string;
  hidden_reason?: string;
  constructor(code: string, message: string, hidden_reason?: string) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    if (hidden_reason) this.hidden_reason = hidden_reason;
  }
}
