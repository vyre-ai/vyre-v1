// What agentd refuses with. The control program prints {"code","message"} for these, and modules/computers maps the code (handlers/tools/common.ts):
// timeout, paused (a person has the controls, or Esc), not_found, bad_input, held, unavailable.
export type ToolCode = "timeout" | "paused" | "not_found" | "bad_input" | "held" | "unavailable";

/** A reason a caller may act on, which never changes with the wording: `profile_held` (a person has the controls of that profile), `profile_busy` (a step is running in it). */
export type ToolReason = "profile_held" | "profile_busy" | "browser_full";

export class AgentError extends Error {
  readonly code: ToolCode;
  readonly reason: ToolReason | undefined;
  constructor(code: ToolCode, message: string, reason?: ToolReason) { super(message); this.name = "AgentError"; this.code = code; this.reason = reason; }
}

export const badInput = (m: string): AgentError => new AgentError("bad_input", m);
export const notFound = (m: string): AgentError => new AgentError("not_found", m);
export const unavailable = (m: string): AgentError => new AgentError("unavailable", m);
export const paused = (m: string): AgentError => new AgentError("paused", m);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function within<T>(ms: number, what: string, f: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AgentError("timeout", `${what} took longer than ${Math.round(ms / 1000)} seconds`)), ms); });
  try { return await Promise.race([f(), late]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

