// Vyre's own user agent for calls to AI providers that want to know the caller (OpenCode refuses a generic SDK or HTTP library agent), and the OpenCode session header.
import { readFileSync } from "node:fs";

let version: string | null = null;
/** This Vyre's version: VYRE_VERSION (the launcher sets it), else the repository's package.json, else "dev". */
export function vyreVersion(): string {
  if (version !== null) return version;
  const env = process.env["VYRE_VERSION"];
  if (env && /^[\w.+-]{1,40}$/.test(env)) return (version = env);
  try { const v = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown }).version; if (typeof v === "string" && v !== "") return (version = v); } catch { /* no package.json here */ }
  return (version = "dev");
}

/** `vyre/<version>`. */
export const vyreUserAgent = (): string => `vyre/${vyreVersion()}`;

/** The session header OpenCode Go wants on a chat: a stable id of the conversation. */
export const OPENCODE_SESSION = "x-opencode-session";

/** Whether an address is OpenCode's own (opencode.ai or a host under it). */
export function isOpencode(address: string): boolean {
  let host = "";
  try { host = new URL(address).hostname.toLowerCase(); } catch { return false; }
  return host === "opencode.ai" || host.endsWith(".opencode.ai");
}
