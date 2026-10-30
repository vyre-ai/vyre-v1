// The stored connectors, their levels, the hosts a person allowed a key to reach, and the state of each polling trigger.
// A row holds a definition and the name of a Vault item. It never holds a key.
import { actionFingerprint, actionStepKey, triggerFingerprint, triggerLevelKey } from "./connector-def.ts";
import type { ConnectorDef } from "./connector-def.ts";
import { clearConnectorLevel, proven, recordConnectorLevel, storedLevel } from "./connector-level.ts";
import type { LevelDb, StoredLevel } from "./connector-level.ts";
import { freshState } from "./connector-poll.ts";
import type { PollState } from "./connector-poll.ts";

export type Db = LevelDb;

export interface ConnectorRow {
  def: ConnectorDef;
  vaultHandle: string | null;
  owner: { kind: string; id: string };
  fingerprints: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  publishedBy: string | null;
}

interface Raw {
  app: string; title: string; def: string; vault_handle: string | null; owner_kind: string; owner_id: string; fingerprints: string;
  created_at: number; updated_at: number; published_at: number | null; published_by: string | null;
}

function parse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}
function toRow(r: Raw): ConnectorRow {
  return {
    def: parse<ConnectorDef>(r.def, { app: r.app, title: r.title, domains: [], auth: { type: "none" }, actions: [], triggers: [] }),
    vaultHandle: r.vault_handle,
    owner: { kind: r.owner_kind, id: r.owner_id },
    fingerprints: parse<Record<string, string>>(r.fingerprints, {}),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    publishedAt: r.published_at === null ? null : Number(r.published_at), publishedBy: r.published_by,
  };
}

export function getConnector(db: Db, app: string): ConnectorRow | undefined {
  const rows = db.all(`SELECT * FROM automations_connectors WHERE app = ? AND deleted_at IS NULL`, app) as Raw[];
  return rows[0] ? toRow(rows[0]) : undefined;
}
export function listConnectors(db: Db): ConnectorRow[] {
  return (db.all(`SELECT * FROM automations_connectors WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE, app`) as Raw[]).map(toRow);
}

export function levelOfAction(db: Db, app: string, action: string): StoredLevel {
  return storedLevel(db, actionStepKey(app, action)) ?? "draft";
}
export function levelOfTrigger(db: Db, app: string, trigger: string): StoredLevel {
  return storedLevel(db, triggerLevelKey(app, trigger)) ?? "draft";
}

/** The level of a whole connector: published when any action or trigger is, else tested when any is proven, else draft. */
export function connectorLevel(db: Db, def: ConnectorDef): StoredLevel {
  const levels = [
    ...def.actions.map((a) => levelOfAction(db, def.app, a.key)),
    ...def.triggers.map((t) => levelOfTrigger(db, def.app, t.key)),
  ];
  if (levels.includes("published")) return "published";
  return levels.some((l) => proven(l)) ? "tested" : "draft";
}

/**
 * Store a definition. A part that changed, or that is new, goes to draft. A part that is the same keeps the level a read earned.
 * Levels of parts that were removed are cleared, so a later connector with the same names starts at draft.
 */
export function saveConnector(db: Db, def: ConnectorDef, o: { vaultHandle: string | null; owner: { kind: string; id: string }; now: number }): ConnectorRow {
  const before = getConnector(db, def.app);
  const prints: Record<string, string> = {};
  const keys = new Set<string>();
  for (const a of def.actions) {
    const key = actionStepKey(def.app, a.key);
    keys.add(key);
    prints[key] = actionFingerprint(def, a);
    if (before?.fingerprints[key] !== prints[key]) recordConnectorLevel(db, key, "draft", o.now);
    else if (storedLevel(db, key) === undefined) recordConnectorLevel(db, key, "draft", o.now);
  }
  for (const t of def.triggers) {
    const key = triggerLevelKey(def.app, t.key);
    keys.add(key);
    prints[key] = triggerFingerprint(def, t);
    if (before?.fingerprints[key] !== prints[key]) {
      recordConnectorLevel(db, key, "draft", o.now);
      db.run(`DELETE FROM automations_connector_poll WHERE app = ? AND trigger_key = ?`, def.app, t.key);
    } else if (storedLevel(db, key) === undefined) recordConnectorLevel(db, key, "draft", o.now);
  }
  if (before) {
    for (const old of Object.keys(before.fingerprints)) {
      if (keys.has(old)) continue;
      clearConnectorLevel(db, old);
      if (old.startsWith("trigger:")) {
        const trig = old.slice(`trigger:${def.app}.`.length);
        db.run(`DELETE FROM automations_connector_poll WHERE app = ? AND trigger_key = ?`, def.app, trig);
        db.run(`DELETE FROM automations_connector_hooks WHERE app = ? AND trigger_key = ?`, def.app, trig);
      }
    }
  }
  const stillPublished = [...keys].some((k) => storedLevel(db, k) === "published");
  const text = JSON.stringify(def);
  if (before) {
    db.run(
      `UPDATE automations_connectors SET title = ?, def = ?, vault_handle = ?, fingerprints = ?, updated_at = ?, published_at = ?, published_by = ? WHERE app = ?`,
      def.title, text, o.vaultHandle, JSON.stringify(prints), o.now, stillPublished ? before.publishedAt : null, stillPublished ? before.publishedBy : null, def.app,
    );
  } else {
    db.run(
      `INSERT OR REPLACE INTO automations_connectors (app, title, def, vault_handle, owner_kind, owner_id, fingerprints, created_at, updated_at, published_at, published_by, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      def.app, def.title, text, o.vaultHandle, o.owner.kind, o.owner.id, JSON.stringify(prints), o.now, o.now,
    );
  }
  return getConnector(db, def.app)!;
}

export function removeConnector(db: Db, row: ConnectorRow, now: number): void {
  for (const k of Object.keys(row.fingerprints)) clearConnectorLevel(db, k);
  db.run(`UPDATE automations_connectors SET deleted_at = ? WHERE app = ?`, now, row.def.app);
  db.run(`DELETE FROM automations_connector_poll WHERE app = ?`, row.def.app);
  db.run(`DELETE FROM automations_connector_hooks WHERE app = ?`, row.def.app);
}

/** Every part at tested becomes published. Returns the keys that moved. */
export function publishTested(db: Db, row: ConnectorRow, by: string, now: number): string[] {
  const moved: string[] = [];
  for (const key of Object.keys(row.fingerprints)) {
    if (storedLevel(db, key) === "tested") { recordConnectorLevel(db, key, "published", now); moved.push(key); }
  }
  if (moved.length > 0) db.run(`UPDATE automations_connectors SET published_at = ?, published_by = ?, updated_at = ? WHERE app = ?`, now, by, now, row.def.app);
  return moved;
}

// ---- hosts a key may reach

export function hostTrusted(db: Db, item: string, host: string): boolean {
  return (db.all(`SELECT 1 AS one FROM automations_connector_hosts WHERE item = ? AND host = ?`, item.toLowerCase(), host.toLowerCase()) as unknown[]).length > 0;
}
export function trustHost(db: Db, item: string, host: string, by: string, now: number): void {
  db.run(`INSERT OR IGNORE INTO automations_connector_hosts (item, host, trusted_by, at) VALUES (?, ?, ?, ?)`, item.toLowerCase(), host.toLowerCase(), by, now);
}

// ---- polling state

interface PollRaw { cursor: string | null; seen: string; primed: number; fails: number; next_at: number; last_at: number | null; last_status: number | null; last_error: string | null; fired: number }
export interface PollRow extends PollState { lastAt: number | null; lastStatus: number | null; lastError: string | null; fired: number }

export function getPoll(db: Db, app: string, trigger: string): PollRow {
  const r = (db.all(`SELECT * FROM automations_connector_poll WHERE app = ? AND trigger_key = ?`, app, trigger) as PollRaw[])[0];
  if (!r) return { ...freshState(), lastAt: null, lastStatus: null, lastError: null, fired: 0 };
  return {
    cursor: r.cursor, seen: parse<string[]>(r.seen, []), primed: r.primed === 1, fails: Number(r.fails), nextAt: Number(r.next_at),
    lastAt: r.last_at === null ? null : Number(r.last_at), lastStatus: r.last_status === null ? null : Number(r.last_status), lastError: r.last_error, fired: Number(r.fired),
  };
}
export function savePoll(db: Db, app: string, trigger: string, s: PollRow): void {
  db.run(
    `INSERT OR REPLACE INTO automations_connector_poll (app, trigger_key, cursor, seen, primed, fails, next_at, last_at, last_status, last_error, fired) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    app, trigger, s.cursor, JSON.stringify(s.seen), s.primed ? 1 : 0, s.fails, s.nextAt, s.lastAt, s.lastStatus, s.lastError, s.fired,
  );
}

// ---- webhook secrets

export function getHook(db: Db, app: string, trigger: string): { secret: string; rotatedAt: number; lastDeliveryAt: number | null } | undefined {
  const r = (db.all(`SELECT secret, rotated_at, last_delivery_at FROM automations_connector_hooks WHERE app = ? AND trigger_key = ?`, app, trigger) as { secret: string; rotated_at: number; last_delivery_at: number | null }[])[0];
  return r ? { secret: r.secret, rotatedAt: Number(r.rotated_at), lastDeliveryAt: r.last_delivery_at === null ? null : Number(r.last_delivery_at) } : undefined;
}
export function setHook(db: Db, app: string, trigger: string, secret: string, now: number): void {
  db.run(`INSERT OR REPLACE INTO automations_connector_hooks (app, trigger_key, secret, rotated_at, last_delivery_at) VALUES (?, ?, ?, ?, NULL)`, app, trigger, secret, now);
}
export function markDelivery(db: Db, app: string, trigger: string, now: number): void {
  db.run(`UPDATE automations_connector_hooks SET last_delivery_at = ? WHERE app = ? AND trigger_key = ?`, now, app, trigger);
}

/** True when this delivery id is new. A repeat answers false. */
export function noteDelivery(db: Db, app: string, trigger: string, id: string, now: number): boolean {
  return db.run(`INSERT OR IGNORE INTO automations_connector_deliveries (app, trigger_key, delivery_id, at) VALUES (?, ?, ?, ?)`, app, trigger, id, now).changes > 0;
}

/** Constant-time comparison of a posted secret with the stored one. */
export function hookSecretMatches(db: Db, app: string, trigger: string, given: string): boolean {
  const have = getHook(db, app, trigger);
  if (!have) return false;
  let diff = have.secret.length ^ given.length;
  for (let i = 0; i < Math.max(have.secret.length, given.length); i++) diff |= (have.secret.charCodeAt(i) || 0) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}
