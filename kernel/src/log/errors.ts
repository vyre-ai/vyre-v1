export type LogErrorCode = "bad_event" | "wrong_space" | "log_closed" | "idem_conflict" | "bad_key" | "internal";

export class LogError extends Error {
  code: LogErrorCode;
  constructor(code: LogErrorCode, message: string) {
    super(message);
    this.name = "LogError";
    this.code = code;
  }
}
