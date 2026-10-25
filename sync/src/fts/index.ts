// Local search (ARCH 9, spec 3.0 Cmd-K, b11): an FTS5 index over the replica's own `fts` rows, with prefix indexes, bm25 ranking (title over body), type filters and the Cmd-K prefixes.
//   @ people and agents    # chats and records    / files    > actions (matched against a list, not indexed)
// The index is built once after the last snapshot page (`rebuild`) and kept current row by row (`update`, `remove`) from the change feed. Cmd-K merges these hits with the server's.
// A phone searches only what its replica holds; `scope` says so, so the UI can.
import { ReplicaError } from "../replica/types.ts";
import type { DeviceClass, SqlDriver } from "../replica/types.ts";

export type SearchKind = "person" | "agent" | "chat" | "record" | "file" | "inbox" | "memory" | "mail" | "call" | "event" | "other";

/** Which Cmd-K type each synced entity belongs to. A record type the Space defined itself is a record. */
const KIND_OF_ENTITY: Readonly<Record<string, SearchKind>> = {
  principal: "person", agent: "agent", thread: "chat", message: "chat", sms: "chat", file: "file", contact_address: "inbox", mail_message: "mail",
  fact: "memory", call: "call", calendar_event: "event", vault_meta: "other",
};

export function kindOf(entity: string): SearchKind {
  return KIND_OF_ENTITY[entity] ?? "record";
}

const PRIORITY: readonly SearchKind[] = ["person", "agent", "chat", "record", "file", "inbox", "event", "mail", "memory", "call", "other"];
const priority = (k: SearchKind): number => PRIORITY.indexOf(k);
/** Candidates read in static-rank order before bm25 reorders them. Rare queries have fewer matches than this, so they are ranked exactly. */
export const CANDIDATES = 400;
/** Rows added or changed since the last rebuild live in a small second index that is always searched in full, so a just-created record is found by its first letter. */
export const RECENT_MAX = 500;

export const PREFIX_KINDS: Readonly<Record<string, readonly SearchKind[]>> = {
  "@": ["person", "agent"],
  "#": ["chat", "record"],
  "/": ["file"],
};

export interface SearchHit { entity: string; id: string; kind: SearchKind; title: string; snippet: string; score: number }

export interface SearchResult {
  hits: SearchHit[];
  /** The prefix that narrowed the search ("@", "#", "/"), or null. */
  prefix: string | null;
  /** "replica" on a phone: it only knows what it holds. */
  scope: "replica" | "full";
  /** An action query (">") is answered by searchActions, not by this index. */
  actions: boolean;
}

export interface SearchOptions {
  kinds?: readonly SearchKind[];
  limit?: number;
}

export interface SearchIndex {
  /** Build the index from the replica's fts rows. Run after the last snapshot page. Returns rows indexed. */
  rebuild(): number;
  /** Re-index one row from the replica's fts table (add, change). */
  update(entity: string, id: string): void;
  remove(entity: string, id: string): void;
  search(query: string, o?: SearchOptions): SearchResult;
  count(): number;
}

const TOKEN = /[\p{L}\p{N}_]+/gu;

/** FTS5 MATCH text from what was typed: every word quoted, every word a prefix so typing narrows as it goes. */
export function matchText(q: string): string | null {
  const words = q.match(TOKEN);
  if (!words || words.length === 0) return null;
  return words.map((w) => `"${w.replaceAll('"', "")}"*`).join(" ");
}

/** Split the Cmd-K prefix off the typed text. */
export function splitPrefix(q: string): { prefix: string | null; rest: string } {
  const t = q.trimStart();
  const c = t.charAt(0);
  if (c === "@" || c === "#" || c === "/" || c === ">") return { prefix: c, rest: t.slice(1) };
  return { prefix: null, rest: t };
}

export function createSearchIndex(driver: SqlDriver, o: { deviceClass?: DeviceClass; limit?: number } = {}): SearchIndex {
  if (!driver.sync) throw new ReplicaError("not_ready", "local search needs a driver that reads synchronously");
  driver.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS search_idx USING fts5(title, body, kind, entity UNINDEXED, id UNINDEXED, tokenize='unicode61 remove_diacritics 2', prefix='1 2 3 4')",
  );
  driver.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS search_recent USING fts5(title, body, kind, entity UNINDEXED, id UNINDEXED, tokenize='unicode61 remove_diacritics 2', prefix='1 2 3 4')",
  );
  const delRecent = driver.prepare("DELETE FROM search_recent WHERE entity = ? AND id = ?");
  const insRecent = driver.prepare("INSERT INTO search_recent (title, body, entity, id, kind) VALUES (?, ?, ?, ?, ?)");
  const trimRecent = driver.prepare("DELETE FROM search_recent WHERE rowid <= (SELECT max(rowid) FROM search_recent) - ?");
  const totalRecent = driver.prepare("SELECT count(*) AS n FROM search_recent");
  const readFts = driver.prepare("SELECT title, body FROM fts WHERE entity = ? AND id = ?");
  const del = driver.prepare("DELETE FROM search_idx WHERE entity = ? AND id = ?");
  const ins = driver.prepare("INSERT INTO search_idx (title, body, entity, id, kind) VALUES (?, ?, ?, ?, ?)");
  const entities = driver.prepare("SELECT DISTINCT entity FROM fts");
  const total = driver.prepare("SELECT count(*) AS n FROM search_idx");
  const defaultLimit = o.limit ?? 20;
  const scope = o.deviceClass === "phone" ? "replica" : "full";

  const index: SearchIndex = {
    rebuild() {
      let n = 0;
      driver.transaction(() => {
        driver.exec("DELETE FROM search_idx");
        driver.exec("DELETE FROM search_recent");
        // Rows are inserted in priority order (people and agents, then chats, records, files, the rest; newest first inside an entity), so rowid order IS the static rank.
        // A search reads candidates in rowid order and stops early; that is what keeps a one-letter prefix fast.
        const names = entities.all([]).map((r) => String(r.entity)).sort((a, b) => priority(kindOf(a)) - priority(kindOf(b)) || a.localeCompare(b));
        for (const entity of names) {
          driver.prepare("INSERT INTO search_idx (title, body, entity, id, kind) SELECT title, body, entity, id, ? FROM fts WHERE entity = ? ORDER BY rowid DESC").run([kindOf(entity), entity]);
        }
        n = Number(total.get([])?.n ?? 0);
        driver.exec("INSERT INTO search_idx (search_idx) VALUES ('optimize')");
      });
      return n;
    },
    update(entity, id) {
      const row = readFts.get([entity, id]);
      driver.transaction(() => {
        // The old copy leaves the ranked index; the new one goes to the recent index, which every search reads in full.
        del.run([entity, id]);
        delRecent.run([entity, id]);
        if (row) {
          insRecent.run([String(row.title ?? ""), String(row.body ?? ""), entity, id, kindOf(entity)]);
          trimRecent.run([RECENT_MAX]);
        }
      });
    },
    remove(entity, id) {
      del.run([entity, id]);
      delRecent.run([entity, id]);
    },
    count: () => Number(total.get([])?.n ?? 0) + Number(totalRecent.get([])?.n ?? 0),
    search(query, so = {}) {
      const { prefix, rest } = splitPrefix(query);
      if (prefix === ">") return { hits: [], prefix, scope, actions: true };
      const match = matchText(rest);
      if (!match) return { hits: [], prefix, scope, actions: false };
      const kinds = so.kinds ?? (prefix ? PREFIX_KINDS[prefix] : undefined);
      // The type filter is part of the MATCH (kind is an indexed column), so a rare kind (one file among 110k rows) is found by its own posting list, not by scanning every row a broad prefix matches.
      const kindMatch = kinds && kinds.length ? ` AND kind : (${kinds.map((k) => `"${k}"`).join(" OR ")})` : "";
      const text = (m: string): string => `{title body} : (${m})`;
      // Stage 1: candidates in rowid (static rank) order, title matches first, then matches anywhere. LIMIT stops the scan early, so a broad prefix costs the same as a narrow one.
      const pick = (m: string): number[] => driver.prepare(`SELECT rowid AS r FROM search_idx WHERE search_idx MATCH ? ORDER BY rowid LIMIT ${CANDIDATES}`).all([m]).map((r) => Number(r.r));
      let cand = pick(`title : (${match})${kindMatch}`);
      if (cand.length < CANDIDATES) {
        const seen = new Set(cand);
        for (const r of pick(`${text(match)}${kindMatch}`)) { if (!seen.has(r)) cand.push(r); if (cand.length >= CANDIDATES) break; }
      }
      const limit = so.limit ?? defaultLimit;
      const toHit = (r: Record<string, unknown>): SearchHit => ({
        entity: String(r.entity), id: String(r.id), kind: String(r.kind) as SearchKind, title: String(r.title ?? ""), snippet: String(r.snip ?? ""), score: Number(r.score),
      });
      // Recent rows first: small, searched whole, ranked by bm25 among themselves.
      const recent = driver.prepare(
        `SELECT entity, id, kind, title, snippet(search_recent, 1, '[', ']', '…', 12) AS snip, bm25(search_recent, 8.0, 1.0, 0.0) AS score FROM search_recent WHERE search_recent MATCH ? ORDER BY score LIMIT ?`,
      ).all([`${text(match)}${kindMatch}`, limit]).map(toHit);
      if (cand.length === 0) return { hits: recent, prefix, scope, actions: false };
      cand = cand.slice(0, CANDIDATES);
      // Stage 2: bm25 (title over body) among the candidates.
      const rows = driver.prepare(
        `SELECT entity, id, kind, title, snippet(search_idx, 1, '[', ']', '…', 12) AS snip, bm25(search_idx, 8.0, 1.0, 0.0) AS score FROM search_idx WHERE search_idx MATCH ? AND rowid IN (${cand.join(",")}) ORDER BY score LIMIT ?`,
      ).all([text(match), limit]).map(toHit);
      return { hits: [...recent, ...rows].slice(0, limit), prefix, scope, actions: false };
    },
  };
  return index;
}

export interface SearchAction { id: string; label: string; keywords?: readonly string[] }

/** `>` actions: New task, Call Elena, Switch skin, Set yourself away, Go offline. Every typed word must start a word of the label or a keyword. */
export function searchActions(query: string, actions: readonly SearchAction[], limit = 20): SearchAction[] {
  const { rest } = splitPrefix(query.startsWith(">") ? query : `>${query}`);
  const words = (rest.toLowerCase().match(TOKEN) ?? []);
  const scored: Array<{ a: SearchAction; s: number }> = [];
  for (const a of actions) {
    const pool = `${a.label} ${(a.keywords ?? []).join(" ")}`.toLowerCase().match(TOKEN) ?? [];
    const labelWords = a.label.toLowerCase().match(TOKEN) ?? [];
    let s = 0;
    let ok = true;
    for (const w of words) {
      if (labelWords.some((p) => p.startsWith(w))) s += labelWords[0]?.startsWith(w) ? 3 : 2;
      else if (pool.some((p) => p.startsWith(w))) s += 1;
      else { ok = false; break; }
    }
    if (ok) scored.push({ a, s });
  }
  return scored.sort((x, y) => y.s - x.s || x.a.label.localeCompare(y.a.label)).slice(0, limit).map((x) => x.a);
}
