// The one Vault item a key reference means for one asker, chosen the way the Vault's own reader chooses it (modules/vault/handlers/use.ts read): by handle, the asker's own Mine item first, else
// the Shared item of that handle. The Gate's hold, the card's lookup and the send all resolve through this, and the send then asks the Vault by the canonical handle found here, so the item a person
// approved is the item whose key goes out. An item id is accepted only when its handle leads back to that same item for this asker. A name, an alias or anything unclear resolves to nothing, and a
// caller must then refuse or hold.

import { approvableHost, hostCovers } from "../../../lib/key-target.ts";
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
  try { return (db.all(`SELECT host FROM automations_key_hosts WHERE item_id = ? AND host != ''`, itemId) as { host: string }[]).some((r) => hostCovers(r.host, host)); } catch { return false; }
}

type Log = { read(q: { type?: string; entity?: string; entity_id?: string; limit?: number }): Promise<{ actor?: string; seq?: number; payload?: unknown }[]> } | null;
const isPerson = (a: unknown): a is string => typeof a === "string" && a.startsWith("usr_");

/**
 * The update's one-time step (review, third look): a connection made before keys had approved hosts keeps its connector's hosts only where people chose them all: a PERSON created the connection
 * (connection.created, audited, carries the actor), a PERSON published the connector's live version (connector.published), and the person who bound it may use the key. Then each declared domain is
 * recorded as approved for that key, by that person. Anything else is never adopted: its next request is refused with the plain line and waits for a person. Nothing is adopted at request time.
 */
export async function adoptPersonBindings(o: {
  db: { all(sql: string, ...a: unknown[]): unknown[]; run(sql: string, ...a: unknown[]): unknown };
  log: Log;
  connections: readonly { connectionId?: unknown; connector?: unknown; handles?: unknown }[];
  domainsOf(connector: string): Promise<unknown>;
  /** the connector's live version (cn_connectors.version), or null when it is not live */
  liveVersion(connector: string): string | null;
  /** a built-in connector (seeded from the registry) */
  isBuiltin(connector: string): boolean;
  usableBy(person: string): Promise<readonly { id?: unknown; handle?: unknown; yourLevel?: unknown }[]>;
  now: number;
}): Promise<number> {
  if (!o.log) return 0;
  let adopted = 0;
  for (const c of o.connections) {
    if (typeof c.connectionId !== "string" || typeof c.connector !== "string" || !Array.isArray(c.handles)) continue;
    const binder = (await o.log.read({ type: "connection.created", entity: "connection", entity_id: c.connectionId, limit: 10 })).map((e) => e.actor).find(isPerson);
    if (!binder) continue;
    // the version that is live now was published by a person (its own connector.published event, matched by version: the event's actor is the agent when an agent did it, unlike the
    // version row, which records whom it acted for), and the last act that made a version live (a publish or a rollback, whichever is newer) was a person's too
    const live = o.liveVersion(c.connector);
    if (!live) continue;
    const published = await o.log.read({ type: "connector.published", entity: "connector", entity_id: c.connector, limit: 500 });
    const rolled = await o.log.read({ type: "connector.rolled_back", entity: "connector", entity_id: c.connector, limit: 500 });
    // a built-in connector nobody has published over or rolled back is the product's own, seeded live with no event: its domains come from the registry, not from an agent
    const productOwn = o.isBuiltin(c.connector) && published.length === 0 && rolled.length === 0;
    if (!productOwn) {
      // the log hands the payload back as the JSON's bytes
      const versionOf = (e: { payload?: unknown }): string | undefined => {
        let p: unknown = e.payload;
        try { if (p instanceof Uint8Array) p = JSON.parse(Buffer.from(p).toString("utf8")); else if (typeof p === "string") p = JSON.parse(p); } catch { return undefined; }
        const v = (p as { version?: unknown } | null | undefined)?.version;
        return typeof v === "string" ? v : undefined;
      };
      const publishedLive = published.filter((e) => versionOf(e) === live);
      if (publishedLive.length === 0 || !publishedLive.every((e) => isPerson(e.actor))) continue;
      const made = [...published, ...rolled].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      if (!isPerson(made[made.length - 1]?.actor)) continue;
    }
    const domains = await o.domainsOf(c.connector);
    if (!Array.isArray(domains)) continue;
    const usable = await o.usableBy(binder);
    for (const h of c.handles) {
      if (typeof h !== "string") continue;
      const base = h.replace(/\.[A-Za-z][A-Za-z0-9_]*$/, "").toLowerCase();
      const item = usable.find((u) => typeof u.handle === "string" && u.handle.toLowerCase() === base && typeof u.yourLevel === "string" && ["use", "edit", "manage"].includes(u.yourLevel));
      if (!item || typeof item.id !== "string") continue;
      for (const d of domains) {
        if (typeof d !== "string") continue;
        const host = approvableHost(d);
        if (host === null) continue;
        o.db.run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, item.id, host, binder, o.now);
        adopted += 1;
      }
    }
  }
  return adopted;
}
/** The handle of an item, for a line a person reads; "this key" when it is not found. */
export function handleOfItem(db: { all(sql: string, ...a: unknown[]): unknown[] }, itemId: string): string {
  try { const r = db.all(`SELECT "handle" FROM vault_meta WHERE "id" = ?`, itemId)[0] as { handle?: unknown } | undefined; return typeof r?.handle === "string" ? r.handle : "This key"; } catch { return "This key"; }
}


/**
 * rc.25 behaviour on the sync-spec path only (see daemon.ts keyHostCheck): the spec's sample and survey probe, or a connection sync_specs.apply made (a cn_sync_specs row for this connector
 * AND connection) going to exactly its own spec's app.domain. Anything else is false and keeps the per-key host rule. rc.27 replaces this with the first-use card.
 */
export function syncSpecHostAllowed(tables: { all(sql: string, ...a: unknown[]): unknown[] } | null, k: { connector: string; connectionId: string }, host: string): boolean {
  if (k.connector === "sync_spec" && k.connectionId === "probe") return true;
  try {
    const row = tables?.all("SELECT spec FROM cn_sync_specs WHERE connector = ? AND connection_id = ?", k.connector, k.connectionId)[0] as { spec?: string } | undefined;
    const domain = row?.spec ? (JSON.parse(row.spec) as { app?: { domain?: unknown } }).app?.domain : undefined;
    return typeof domain === "string" && domain.trim().toLowerCase().replace(/\.$/, "") === host;
  } catch { return false; }
}
