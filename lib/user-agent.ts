// Vyre's own user agent for calls to AI providers that want to know the caller (OpenCode refuses a generic SDK or HTTP library agent), and the OpenCode session header.
let version: string | null = null;
/**
 * This Vyre's version: VYRE_VERSION (the launcher and the daemon set it, host/src/daemon/main.ts), else npm's own variable when run from the repository, else 0.0.0-dev as the daemon says. No file is read: a staged bundle
 * carries no package.json beside this module.
 */
export function vyreVersion(): string {
  if (version !== null) return version;
  for (const env of [process.env["VYRE_VERSION"], process.env["npm_package_version"]]) if (env && /^[\w.+-]{1,40}$/.test(env)) return (version = env);
  return (version = "0.0.0-dev");   // the daemon's own default (host/src/daemon/main.ts)
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
