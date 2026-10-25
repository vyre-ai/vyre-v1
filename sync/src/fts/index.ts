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
    "CREATE VIRTUAL TABLE IF NOT EXISTS search_idx USING fts5(title, body, entity UNINDEXED, id UNINDEXED, kind UNINDEXED, tokenize='unicode61 remove_diacritics 2', prefix='1 2 3 4')",
  );
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
        for (const r of entities.all([])) {
          const entity = String(r.entity);
          // one INSERT ... SELECT per entity: the kind is a constant of the entity
          driver.prepare("INSERT INTO search_idx (title, body, entity, id, kind) SELECT title, body, entity, id, ? FROM fts WHERE entity = ?").run([kindOf(entity), entity]);
        }
        n = Number(total.get([])?.n ?? 0);
        driver.exec("INSERT INTO search_idx (search_idx) VALUES ('optimize')");
      });
      return n;
    },
    update(entity, id) {
      const row = readFts.get([entity, id]);
      driver.transaction(() => {
        del.run([entity, id]);
        if (row) ins.run([String(row.title ?? ""), String(row.body ?? ""), entity, id, kindOf(entity)]);
      });
    },
    remove(entity, id) {
      del.run([entity, id]);
    },
    count: () => Number(total.get([])?.n ?? 0),
    search(query, so = {}) {
      const { prefix, rest } = splitPrefix(query);
      if (prefix === ">") return { hits: [], prefix, scope, actions: true };
      const match = matchText(rest);
      if (!match) return { hits: [], prefix, scope, actions: false };
      const kinds = so.kinds ?? (prefix ? PREFIX_KINDS[prefix] : undefined);
      const args: (string | number)[] = [match];
      let where = "search_idx MATCH ?";
      if (kinds && kinds.length) {
        where += ` AND kind IN (${kinds.map(() => "?").join(", ")})`;
        args.push(...kinds);
      }
      args.push(so.limit ?? defaultLimit);
      const rows = driver.prepare(
        `SELECT entity, id, kind, title, snippet(search_idx, 1, '[', ']', '…', 12) AS snip, bm25(search_idx, 8.0, 1.0) AS score FROM search_idx WHERE ${where} ORDER BY score LIMIT ?`,
      ).all(args);
      return {
        hits: rows.map((r) => ({
          entity: String(r.entity), id: String(r.id), kind: String(r.kind) as SearchKind, title: String(r.title ?? ""), snippet: String(r.snip ?? ""), score: Number(r.score),
        })),
        prefix, scope, actions: false,
      };
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
