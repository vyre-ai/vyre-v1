// The host sends one connector read. The module receives only the status.
// The Vault value stays in this function and is not returned.
// With the pinned network the module hands over (the one docs and the HTTP step use), the host is looked up once, any private, loopback or metadata answer refuses the read, and the socket is
// dialled to exactly the addresses that were checked: a name that answers public first and private next (DNS rebinding) cannot move the key. A redirect is never followed (the status comes back).

import { isIP } from "node:net";
import { normalizedHost, refusesAddress } from "../../../lib/address-guard.ts";
import { hostOfUrl } from "../../../lib/key-target.ts";
import type { KeyRef } from "./key-ref.ts";
import type { SeamDriverDeps } from "./index.ts";

/** What the module's document network gives: a lookup and a connect that dials the given addresses. */
export interface PinnedNet {
  lookup(host: string): Promise<string[]>;
  connect?(req: { url: URL; addresses: readonly string[]; signal: AbortSignal; method?: string; headers?: Readonly<Record<string, string>> }): Promise<Response>;
}

type Plan = { method: string; url: string; vaultItemId: string; header?: string; prefix?: string };
type Sent = { status: number; failed?: "vault" | "network" | "private" };

/** `resolve` is the one reading of a key reference (seams/key-ref.ts) the Gate's hold used: the key read is the item it named, asked for by its canonical handle. */
export function connectorReadSender(d: Pick<SeamDriverDeps, "vault" | "fetch" | "space">, resolve?: (ref: string, asker?: string) => KeyRef | null): (plan: Plan, asker?: string, net?: PinnedNet | null) => Promise<Sent> {
  return async (plan, asker, net) => {
    let url: URL;
    try { url = new URL(plan.url); } catch { return { status: 0, failed: "network" }; }
    if (url.protocol !== "https:" || hostOfUrl(plan.url) === null) return { status: 0, failed: "network" };
    // the item the hold named, or nothing: a reference that does not resolve the same way is never handed to the Vault
    let ref = plan.vaultItemId;
    if (resolve) {
      const r = resolve(plan.vaultItemId, asker);
      if (r === null) return { status: 0, failed: "vault" };
      ref = `${r.handle}${r.field ? `.${r.field}` : ""}`;
    }
    // the addresses this read may dial, checked before the key is opened
    let addresses: string[] | null = null;
    if (net?.connect) {
      const host = normalizedHost(url.hostname);
      try { addresses = isIP(host) ? [host] : await net.lookup(host); } catch { return { status: 0, failed: "network" }; }
      if (!Array.isArray(addresses) || addresses.length === 0) return { status: 0, failed: "network" };
      if (addresses.some((a) => typeof a !== "string" || refusesAddress(a))) return { status: 0, failed: "private" };
    }
    let value = "";
    try {
      value = await d.vault.secret(ref, d.space, asker);
    } catch {
      return { status: 0, failed: "vault" };
    }
    const headers = { [(plan.header ?? "authorization").toLowerCase()]: `${plan.prefix ?? (plan.header === undefined || plan.header.toLowerCase() === "authorization" ? "Bearer " : "")}${value}` };
    try {
      if (net?.connect && addresses) {
        const response = await net.connect({ url, addresses, signal: AbortSignal.timeout(10_000), method: plan.method, headers });
        try { await response.body?.cancel(); } catch { /* nothing to read */ }
        return { status: response.status };
      }
      const response = await d.fetch(plan.url, { method: plan.method, headers });
      return { status: response.status };
    } catch {
      return { status: 0, failed: "network" };
    } finally {
      value = "";
    }
  };
}
