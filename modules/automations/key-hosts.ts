// A Vault key goes only to a host a person approved for that key (owner rule, 12 Nov 2026). The approved hosts live per item: the host of the item's own saved address (its url or website field,
// and that domain's subdomains, as the Vault's own matcher reads it), plus every host a person who may use the item allowed ("Always allow" on the held test read, or Allow on the item page).
// Nothing here trusts what an agent wrote: not actionKey, not a connector's domains. The planned host is read from the request the test read would actually send.
import { planSafeTest } from "./connector-test.ts";

export interface KeyHostDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface KeyHost { host: string; by: string; at: number }

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** One spelling of a host: lower case, no trailing dot, no port. Null when it is not a plain DNS name. */
export function normalHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/\.$/, "");
  return HOST.test(h) && h.length <= 253 ? h : null;
}

/** The host the test read would send the key to, read from the request it plans (null when it would send nothing, so there is nothing to approve). */
export function plannedHost(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  if (typeof r["method"] !== "string" || typeof r["path"] !== "string" || typeof r["vaultItemId"] !== "string" || !Array.isArray(r["domains"]) || !r["domains"].every((d) => typeof d === "string")) return null;
  const plan = planSafeTest({ method: r["method"], path: r["path"], domains: r["domains"] as string[], vaultItemId: r["vaultItemId"] });
  if (!plan.ok) return null;
  try { return normalHost(new URL(plan.plan.url).hostname); } catch { return null; }
}

export function keyHostsOf(db: KeyHostDb, itemId: string): KeyHost[] {
  try {
    return (db.all(`SELECT host, by, at FROM automations_key_hosts WHERE item_id = ? ORDER BY at ASC, host ASC`, itemId) as { host: string; by: string; at: number }[]).map((r) => ({ host: r.host, by: r.by, at: r.at }));
  } catch { return []; }
}

/** Approved for this item: listed exactly. A listed host does not cover other hosts; the item's own address covers its subdomains (the Vault's matcher decides that, not this table). */
export function keyHostApproved(db: KeyHostDb, itemId: string, host: string): boolean {
  const h = normalHost(host);
  return h !== null && keyHostsOf(db, itemId).some((r) => r.host === h);
}

export function allowKeyHost(db: KeyHostDb, itemId: string, host: string, by: string, now: number): void {
  db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, host, by, now);
}

export function removeKeyHost(db: KeyHostDb, itemId: string, host: string): boolean {
  return db.run(`DELETE FROM automations_key_hosts WHERE item_id = ? AND host = ?`, itemId, host).changes > 0;
}
