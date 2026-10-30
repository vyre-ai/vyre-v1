// A seal scope names what a sealed value belongs to, and ctx.seal accepts only a short name (host/src/ctx/seal.ts: a letter, then up to 63 of letters, digits and _ . : -). The ids a scope should bind
// (a Space, a blob, a change set) can be long: a Space made on a desktop is "spc_" and 32 hex, and the Personal Space limit is 199 characters. So the ids are bound through a digest, never written in.
import { createHash } from "node:crypto";

/** `<prefix>:<24 hex>`, the digest of the parts. The same parts always give the same scope, a different part gives a different one, and the length does not depend on the ids. `prefix` is a short fixed name. */
export function boundedScope(prefix: string, ...parts: readonly string[]): string {
  if (!/^[a-z][a-z0-9_.-]{0,36}$/i.test(prefix)) throw new Error("a seal scope prefix is a short fixed name");
  return `${prefix}:${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`;
}
