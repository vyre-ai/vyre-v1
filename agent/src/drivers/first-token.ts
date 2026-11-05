// The first-token deadline: a turn that opens a reply and gets no text, thinking or tool event is ended cleanly instead of waiting for ever (room-pack.real: an empty agent message for 255 s).
// One constant per kind of engine. The error code has plain words and a Try again action in apps/app/src/places/chats/conversation/status.ts.

/** API engines: from sending the request to the first text, thinking or tool event. */
export const FIRST_TOKEN_API_MS = 90_000;
/** CLI engines start slower (a process, a login, MCP): from the prompt written to the first text, thinking or tool event. */
export const FIRST_TOKEN_CLI_MS = 180_000;

export const NO_FIRST_TOKEN_CODE = "engine.no_first_token";
export const NO_FIRST_TOKEN_LINE = "Your AI didn't answer in time";

/** What the log line carries. */
export interface NoFirstToken { provider: string; model: string; account: string; waitedMs: number }
export type NoFirstTokenLog = (e: NoFirstToken) => void;

/** The default log: one structured line on stderr, no content and no key. */
export const logNoFirstToken: NoFirstTokenLog = (e) => {
  try { console.warn(`[engine] no first token provider=${e.provider} model=${e.model || "default"} account=${e.account || "none"} waited_ms=${e.waitedMs}`); } catch { /* a log never fails a turn */ }
};
