// What agentd refuses with. The control program prints {"code","message"} for these, and modules/computers maps the code (handlers/tools/common.ts):
// timeout, paused (a person has the controls, or Esc), not_found, bad_input, held, unavailable.
export type ToolCode = "timeout" | "paused" | "not_found" | "bad_input" | "held" | "unavailable";

export class AgentError extends Error {
  readonly code: ToolCode;
  constructor(code: ToolCode, message: string) { super(message); this.name = "AgentError"; this.code = code; }
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

/** Handles are #Name.field. The Vault values behind them are not on this computer yet, so a tool that was given one says so instead of typing the handle itself. */
export const HANDLE = /#[A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+/;
export function refuseHandles(v: unknown): void {
  const text = JSON.stringify(v ?? null);
  if (HANDLE.test(text)) throw unavailable("This computer has no Vault filler attached, so it cannot fill a #Handle.field. Nothing was typed.");
}
