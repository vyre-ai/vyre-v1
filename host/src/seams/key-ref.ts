// The one Vault item a key reference means for one asker, chosen the way the Vault's own reader chooses it (modules/vault/handlers/use.ts read): by handle, the asker's own Mine item first, else
// the Shared item of that handle. The Gate's hold, the card's lookup and the send all resolve through this, and the send then asks the Vault by the canonical handle found here, so the item a person
// approved is the item whose key goes out. An item id is accepted only when its handle leads back to that same item for this asker. A name, an alias or anything unclear resolves to nothing, and a
// caller must then refuse or hold.

export interface KeyRef { id: string; handle: string; name: string; field?: string }

const HANDLE = /^#([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?$/;
const ID = /^(vit_[a-z0-9]+)(?:\.([A-Za-z0-9_]+))?$/;

interface Row { id: string; handle: string; name: string; scope: string; owner: string }

function live(db: { all(sql: string, ...a: unknown[]): unknown[] }): Row[] {
  try {
    return (db.all(`SELECT "id", "handle", "name", "scope", "owner" FROM vault_meta WHERE "deleted_at" IS NULL`) as Record<string, unknown>[])
      .map((r) => ({ id: String(r["id"]), handle: String(r["handle"]), name: String(r["name"]), scope: String(r["scope"]), owner: String(r["owner"]) }));
  } catch { return []; }
}

function byHandle(rows: readonly Row[], handle: string, asker: string | undefined): Row | undefined {
  const named = rows.filter((r) => r.handle.toLowerCase() === handle.toLowerCase());
  return (asker ? named.find((r) => r.scope === "mine" && r.owner === asker) : undefined) ?? named.find((r) => r.scope === "shared");
}

export function resolveKeyRef(db: { all(sql: string, ...a: unknown[]): unknown[] }, ref: unknown, asker?: string): KeyRef | null {
  if (typeof ref !== "string") return null;
  const raw = ref.trim();
  const rows = live(db);
  const id = ID.exec(raw);
  if (id) {
    const row = rows.find((r) => r.id === id[1]);
    if (!row || byHandle(rows, row.handle, asker)?.id !== row.id) return null;
    return { id: row.id, handle: row.handle, name: row.name, ...(id[2] ? { field: id[2] } : {}) };
  }
  const m = HANDLE.exec(raw.startsWith("#") ? raw : `#${raw}`);
  if (!m) return null;
  const row = byHandle(rows, `#${m[1]!}`, asker);
  return row ? { id: row.id, handle: row.handle, name: row.name, ...(m[2] ? { field: m[2] } : {}) } : null;
}

/** Has a person approved `host` for this item (automations_key_hosts)? A table that is not there yet approves nothing. */
export function keyHostListed(db: { all(sql: string, ...a: unknown[]): unknown[] }, itemId: string, host: string): boolean {
  if (host === "") return false;
  try { return db.all(`SELECT 1 AS x FROM automations_key_hosts WHERE item_id = ? AND host = ?`, itemId, host).length > 0; } catch { return false; }
}

/**
 * The update path (lead, 12 Nov): a key whose list nobody has kept yet (no marker row, which an approval or a removal leaves) was in use before hosts were approved per key. Its
 * connector's declared domains are approved once, attributed to the person who made that choice (the caller passes them only when one did), so what a person set up before keeps working; from then on the
 * list governs. Returns whether `host` is now approved.
 */
export function adoptConnectorHosts(db: { all(sql: string, ...a: unknown[]): unknown[]; run?(sql: string, ...a: unknown[]): unknown }, itemId: string, host: string, domains: readonly string[], now: number, by = "update"): boolean {
  try {
    // a key whose list people have kept (the marker row an approval or a removal leaves) is never filled again
    if (!db.run || db.all(`SELECT 1 AS x FROM automations_key_hosts WHERE item_id = ? AND host = ''`, itemId).length > 0) return false;
    const hosts = domains.map((d) => d.toLowerCase().replace(/\.$/, "")).filter((d) => d !== "");
    if (!hosts.includes(host)) return false;
    for (const h of [...hosts, ""]) db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, h, by, now);
    return true;
  } catch { return false; }
}

/** The handle of an item, for a line a person reads; "this key" when it is not found. */
export function handleOfItem(db: { all(sql: string, ...a: unknown[]): unknown[] }, itemId: string): string {
  try { const r = db.all(`SELECT "handle" FROM vault_meta WHERE "id" = ?`, itemId)[0] as { handle?: unknown } | undefined; return typeof r?.handle === "string" ? r.handle : "This key"; } catch { return "This key"; }
}

/**
 * Who made the choice that a key goes to this connector's hosts, from the event log: the person who bound the connection (connection.created), else the person who published the connector
 * (connector.published, the latest). Null when the log shows no person did either (an agent bound it and an agent published it): such hosts are never adopted, they wait for a person.
 */
export async function personWhoChose(log: { read(q: { type?: string; entity?: string; entity_id?: string; limit?: number }): Promise<{ actor?: string }[]> } | null, connectionId: string, connector: string): Promise<string | null> {
  if (!log) return null;
  const person = (a: unknown): a is string => typeof a === "string" && a.startsWith("usr_");
  try {
    const bound = await log.read({ type: "connection.created", entity: "connection", entity_id: connectionId, limit: 10 });
    const binder = bound.map((e) => e.actor).find(person);
    if (binder) return binder;
    const published = await log.read({ type: "connector.published", entity: "connector", entity_id: connector, limit: 200 });
    const last = published[published.length - 1]?.actor;
    return person(last) ? last : null;
  } catch { return null; }
}
