// A Vault key goes only to a host a person approved for that key (owner rule, 12 Nov 2026). The approved hosts live per item: the host of the item's own saved address (its url or website field,
// and that domain's subdomains, as the Vault's own matcher reads it), plus every host a person who may use the item allowed ("Always allow" on the held test read, or Allow on the item page).
// Nothing here trusts what an agent wrote: not actionKey, not a connector's domains. The planned host is read from the request the test read would actually send.
import { approvableHost, keyReadHost } from "../../lib/key-target.ts";

export interface KeyHostDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface KeyHost { host: string; by: string; at: number }

/** One spelling of a host as a person approves it (lib/key-target.ts): a DNS name or an IP literal. Null otherwise. */
export function normalHost(raw: string): string | null {
  return approvableHost(raw);
}

/** The host the test read would send the key to, read the one way the Gate, the card and the sender read it. Null when it names none (the caller refuses or holds). */
export function plannedHost(input: unknown): string | null {
  return keyReadHost(input);
}

/** The row that marks a key's list as kept by people (an approval or a removal happened): an update never fills the list of such a key again. Not a host. */
export const MANAGED = "";

export function keyHostsOf(db: KeyHostDb, itemId: string): KeyHost[] {
  try {
    return (db.all(`SELECT host, by, at FROM automations_key_hosts WHERE item_id = ? AND host != '' ORDER BY at ASC, host ASC`, itemId) as { host: string; by: string; at: number }[]).map((r) => ({ host: r.host, by: r.by, at: r.at }));
  } catch { return []; }
}

/** Approved for this item: listed exactly. A listed host does not cover other hosts; the item's own address covers its subdomains (the Vault's matcher decides that, not this table). */
export function keyHostApproved(db: KeyHostDb, itemId: string, host: string): boolean {
  const h = normalHost(host);
  return h !== null && h !== MANAGED && keyHostsOf(db, itemId).some((r) => r.host === h);
}

export function allowKeyHost(db: KeyHostDb, itemId: string, host: string, by: string, now: number): void {
  db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, host, by, now);
  db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, MANAGED, by, now);
}

export function removeKeyHost(db: KeyHostDb, itemId: string, host: string, by = "", now = 0): boolean {
  db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, MANAGED, by, now);
  return db.run(`DELETE FROM automations_key_hosts WHERE item_id = ? AND host = ?`, itemId, host).changes > 0;
}
