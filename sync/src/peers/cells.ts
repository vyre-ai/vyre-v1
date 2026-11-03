// One Personal Space on several computers (lane l-multidevice): each computer holds the whole Space in its own databases, and the computers converge by exchanging cells. A cell is one column
// of one row of one table; it carries the hlc and the site (the computer) that last wrote it. The merge is the rule push uses for a field (server/push/merge.ts `newer`): the later hlc wins and the
// writer breaks a tie, so every computer picks the same winner whatever order the cells arrive in, and applying a cell twice changes nothing.
//
// Why cells of the module tables and not the capability ops of sync/src/outbox: an op is an intent (`chat.send`), and running it again on the other computer would start the turn again. The
// tables are what every capability reads, so they are what the copy is. Why not sync/src/replica: that is a device's mirror of the rows pull hands it; here each computer is a Space.
//
// Capture is plain SQL, so a write from any connection (a module handler, a projection, a script) is seen: AFTER INSERT, UPDATE and DELETE triggers note (table, key, column) in peer_dirty.
// `stamp` then gives each noted cell the hlc of the moment it was written and the next local version, in peer_clock. A computer asks another for the rows whose clocks moved after the version it last
// saw (`changes`) and applies them (`apply`), with the triggers held off (peer_apply.on) and the incoming clocks kept, so the change goes on to a third computer unchanged.
// A delete is the cell `__d`; a row lives while one of its columns is newer than its delete. A row arrives whole (every cell it has a clock for), so an insert never meets a missing column.
// Not copied: tables with no primary key, tables keyed by a single INTEGER (a local sequence: logs, audit chains, queues), virtual tables and their shadows, and what `deny` names.
import { compareHlc, formatHlc, parseHlc, receiveHlc, tickHlc } from "../../../lib/hlc.ts";
import type { Hlc } from "../../../lib/hlc.ts";
import { newer } from "../server/push/merge.ts";

export interface CellDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): unknown;
  exec(sql: string): void;
}

export interface CellOptions {
  /** this computer: the site every hlc it makes ends with */
  site: string;
  now(): number;
  /** tables that stay on this computer */
  deny?(table: string): boolean;
  /** columns that stay on this computer, by table */
  denyColumns?: Readonly<Record<string, readonly string[]>>;
}

/** One cell on the wire. Values are JSON; a BLOB is { $b: base64 }, an integer beyond 2^53 is { $i: "digits" }. */
export interface WireCell { v?: unknown; h: string }
/** One row on the wire: its table, its key (the JSON array of its primary key values), its cells, and its delete cell if it has one. */
export interface RowChange { t: string; k: string; c: Record<string, WireCell>; d?: string }
export interface ChangePage { rows: RowChange[]; next: number; more: boolean; head: number }
/** A unique key two computers both used (the same name made on each while apart). The row whose cell is older is renamed with " (2)" (or the next free number), never dropped. A clash that
 *  cannot be renamed keeps the incoming row whole in peer_conflict (`kept: "aside"`). */
export interface UniqueClash { t: string; k: string; col: string; from: string; to: string; renamed: "incoming" | "local" | "none"; kept: "both" | "aside"; why?: string; otherKey?: string }
export interface ApplyResult { applied: number; unchanged: number; refused: { t: string; k: string; why: string }[]; conflicts: UniqueClash[] }

interface TableInfo { name: string; pk: string[]; cols: string[]; tracked: string[] }

const DEL = "__d";
const META = `
CREATE TABLE IF NOT EXISTS peer_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS peer_dirty (n INTEGER PRIMARY KEY, tbl TEXT NOT NULL, pk TEXT NOT NULL, col TEXT NOT NULL, at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)));
CREATE TABLE IF NOT EXISTS peer_clock (tbl TEXT NOT NULL, pk TEXT NOT NULL, col TEXT NOT NULL, hlc TEXT NOT NULL, site TEXT NOT NULL, ver INTEGER NOT NULL, PRIMARY KEY (tbl, pk, col)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS peer_clock_ver ON peer_clock (ver);
CREATE TABLE IF NOT EXISTS peer_apply (id INTEGER PRIMARY KEY CHECK (id = 1), "on" INTEGER NOT NULL);
INSERT OR IGNORE INTO peer_apply (id, "on") VALUES (1, 0);
CREATE TABLE IF NOT EXISTS peer_cursor (peer TEXT PRIMARY KEY, cursor INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS peer_conflict (n INTEGER PRIMARY KEY, tbl TEXT NOT NULL, pk TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, row TEXT);
`;
const q = (id: string): string => `"${id.replaceAll('"', '""')}"`;
const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

function toWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return { $b: Buffer.from(v).toString("base64") };
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : { $i: v.toString() };
  return v;
}
function fromWire(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o["$b"] === "string") return new Uint8Array(Buffer.from(o["$b"], "base64"));
    if (typeof o["$i"] === "string" && /^-?\d+$/.test(o["$i"])) return BigInt(o["$i"]);
  }
  return v === undefined ? null : v;
}

export interface Cells {
  /** Make the bookkeeping tables and (again) the triggers on every copied table. Run at start and when tables may have been added. Returns the copied tables. */
  install(): string[];
  /** Give every noted local write its clock. Returns how many cells moved. */
  stamp(): number;
  /** Rows whose clocks moved after `since`, oldest first, whole. */
  changes(since: number, limit?: number): ChangePage;
  /** Merge rows from another computer. */
  apply(rows: readonly RowChange[]): ApplyResult;
  head(): number;
  /** Rows this computer wrote that a computer at `cursor` has not seen yet. */
  waiting(cursor: number): number;
  cursor(peer: string): number;
  setCursor(peer: string, cursor: number): void;
  tables(): readonly string[];
}

export function createCells(db: CellDb, o: CellOptions): Cells {
  let infos = new Map<string, TableInfo>();
  const meta = (k: string): string | null => (db.all("SELECT value FROM peer_meta WHERE key = ?", k)[0] as { value?: string } | undefined)?.value ?? null;
  const setMeta = (k: string, v: string): void => { db.run("INSERT INTO peer_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v); };
  let last: Hlc | null = null;
  /** The clock of a write made at `at` (when the trigger noted it, not when it is stamped: a write stamped late must not look newer than one another computer made after it). */
  const tick = (at = o.now()): string => {
    last ??= parseHlc(meta("hlc") ?? "");
    last = tickHlc(o.site, Math.min(at, o.now()), last);
    return formatHlc(last);
  };
  const seen = (h: string): void => {
    const r = parseHlc(h);
    if (!r) return;
    last ??= parseHlc(meta("hlc") ?? "");
    if (!last || compareHlc(r, last) > 0) last = receiveHlc(o.site, o.now(), last, r);
  };
  const nextVer = (): number => { const v = Number(meta("head") ?? "0") + 1; setMeta("head", String(v)); return v; };
  const tx = <T,>(fn: () => T): T => {
    db.exec("SAVEPOINT peer_tx");
    try { const out = fn(); db.exec("RELEASE peer_tx"); return out; } catch (e) { db.exec("ROLLBACK TO peer_tx"); db.exec("RELEASE peer_tx"); throw e; }
  };

  function discover(): Map<string, TableInfo> {
    const rows = db.all("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name") as { name: string; sql: string | null }[];
    const virtual = rows.filter((r) => /^\s*CREATE\s+VIRTUAL/i.test(r.sql ?? "")).map((r) => r.name);
    const out = new Map<string, TableInfo>();
    for (const r of rows) {
      const n = r.name;
      if (n.startsWith("sqlite_") || n.startsWith("peer_") || virtual.some((v) => n === v || n.startsWith(`${v}_`)) || o.deny?.(n)) continue;
      const cols = db.all(`PRAGMA table_info(${q(n)})`) as { name: string; type: string; pk: number }[];
      const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
      if (!pk.length || (pk.length === 1 && /^INTEGER$/i.test(pk[0]!.type)) || pk.some((c) => /BLOB/i.test(c.type))) continue;
      const denyCols = new Set(o.denyColumns?.[n] ?? []);
      const names = cols.map((c) => c.name);
      out.set(n, { name: n, pk: pk.map((c) => c.name), cols: names, tracked: names.filter((c) => !denyCols.has(c)) });
    }
    return out;
  }

  function install(): string[] {
    db.exec(META);
    infos = discover();
    const have = (db.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'peer\\_%' ESCAPE '\\'") as { name: string }[]).map((r) => r.name);
    db.exec("BEGIN");
    try {
      for (const t of have) db.exec(`DROP TRIGGER IF EXISTS ${q(t)}`);
      const off = `(SELECT "on" FROM peer_apply WHERE id = 1) = 0`;
      for (const t of infos.values()) {
        const key = (row: "NEW" | "OLD"): string => `json_array(${t.pk.map((c) => `${row}.${q(c)}`).join(", ")})`;
        const tn = lit(t.name);
        const pkChanged = t.pk.map((c) => `OLD.${q(c)} IS NOT NEW.${q(c)}`).join(" OR ");
        db.exec(`CREATE TRIGGER ${q(`peer_i_${t.name}`)} AFTER INSERT ON ${q(t.name)} WHEN ${off} BEGIN INSERT INTO peer_dirty (tbl, pk, col) VALUES (${tn}, ${key("NEW")}, '*'); END;`);
        db.exec(`CREATE TRIGGER ${q(`peer_d_${t.name}`)} AFTER DELETE ON ${q(t.name)} WHEN ${off} BEGIN INSERT INTO peer_dirty (tbl, pk, col) VALUES (${tn}, ${key("OLD")}, '-'); END;`);
        const per = t.tracked.filter((c) => !t.pk.includes(c)).map((c) => `INSERT INTO peer_dirty (tbl, pk, col) SELECT ${tn}, ${key("NEW")}, ${lit(c)} WHERE NOT (${pkChanged}) AND OLD.${q(c)} IS NOT NEW.${q(c)};`).join(" ");
        db.exec(`CREATE TRIGGER ${q(`peer_u_${t.name}`)} AFTER UPDATE ON ${q(t.name)} WHEN ${off} BEGIN `
          + `INSERT INTO peer_dirty (tbl, pk, col) SELECT ${tn}, ${key("OLD")}, '-' WHERE ${pkChanged}; INSERT INTO peer_dirty (tbl, pk, col) SELECT ${tn}, ${key("NEW")}, '*' WHERE ${pkChanged}; ${per} END;`);
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return [...infos.keys()];
  }

  const upsertClock = (tbl: string, pk: string, col: string, hlc: string, site: string, ver: number): void => {
    db.run("INSERT INTO peer_clock (tbl, pk, col, hlc, site, ver) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tbl, pk, col) DO UPDATE SET hlc = excluded.hlc, site = excluded.site, ver = excluded.ver", tbl, pk, col, hlc, site, ver);
  };

  function stampInside(): number {
    const dirty = db.all("SELECT n, tbl, pk, col, at FROM peer_dirty ORDER BY n LIMIT 20000") as { n: number; tbl: string; pk: string; col: string; at: number }[];
    if (!dirty.length) return 0;
    let moved = 0;
    for (const d of dirty) {
      const t = infos.get(d.tbl);
      if (!t) continue;
      const h = tick(Number(d.at)), v = nextVer();
      if (d.col === "*") { for (const c of t.tracked) { upsertClock(d.tbl, d.pk, c, h, o.site, v); moved++; } }
      else if (d.col === "-") { upsertClock(d.tbl, d.pk, DEL, h, o.site, v); moved++; }
      else if (t.tracked.includes(d.col)) { upsertClock(d.tbl, d.pk, d.col, h, o.site, v); moved++; }
    }
    db.run("DELETE FROM peer_dirty WHERE n <= ?", dirty[dirty.length - 1]!.n);
    if (last) setMeta("hlc", formatHlc(last));
    return moved;
  }
  const stamp = (): number => tx(stampInside);

  const rowOf = (t: TableInfo, pk: string): Record<string, unknown> | null => {
    let key: unknown[];
    try { key = JSON.parse(pk) as unknown[]; } catch { return null; }
    if (!Array.isArray(key) || key.length !== t.pk.length) return null;
    return (db.all(`SELECT * FROM ${q(t.name)} WHERE ${t.pk.map((c) => `${q(c)} IS ?`).join(" AND ")}`, ...key)[0] as Record<string, unknown> | undefined) ?? null;
  };

  function changes(since: number, limit = 500): ChangePage {
    stamp();
    const ids = db.all("SELECT tbl, pk, MAX(ver) AS v FROM peer_clock WHERE ver > ? GROUP BY tbl, pk ORDER BY v LIMIT ?", since, limit) as { tbl: string; pk: string; v: number }[];
    const rows: RowChange[] = [];
    for (const id of ids) {
      const t = infos.get(id.tbl);
      if (!t) continue;
      const clocks = db.all("SELECT col, hlc FROM peer_clock WHERE tbl = ? AND pk = ?", id.tbl, id.pk) as { col: string; hlc: string }[];
      const row = rowOf(t, id.pk);
      const out: RowChange = { t: id.tbl, k: id.pk, c: {} };
      for (const c of clocks) {
        if (c.col === DEL) { out.d = c.hlc; continue; }
        if (row && t.tracked.includes(c.col)) out.c[c.col] = { v: toWire(row[c.col]), h: c.hlc };
      }
      // A row always travels whole: a column written before capture began (a row made at the first start, before the Space had a second computer) has no clock of its own, and without its
      // value the other computer could not make the row at all. It carries the row's newest clock, so it never beats a column the other computer wrote later.
      if (row) {
        const top = clocks.filter((c) => c.col !== DEL).map((c) => c.hlc).sort().pop();
        if (top) for (const col of t.tracked) if (!(col in out.c)) out.c[col] = { v: toWire(row[col]), h: top };
      }
      rows.push(out);
    }
    return { rows, next: ids.length ? ids[ids.length - 1]!.v : since, more: ids.length === limit, head: Number(meta("head") ?? "0") };
  }

  const later = (a: string, b: string | undefined): boolean => {
    if (b === undefined) return true;
    const pa = parseHlc(a);
    return pa ? newer({ hlc: pa, actor: pa.deviceId }, { hlc: b, actor: parseHlc(b)?.deviceId ?? "" }) : false;
  };

  /** The next free value of a text column: "Plan" -> "Plan (2)", "Plan (3)", ... */
  const freeName = (t: TableInfo, col: string, v: string): string => {
    const stem = v.replace(/ \(\d+\)$/, "");
    for (let n = 2; n < 1000; n++) {
      const cand = `${stem} (${n})`;
      if (!db.all(`SELECT 1 FROM ${q(t.name)} WHERE ${q(col)} = ? LIMIT 1`, cand).length) return cand;
    }
    return `${stem} (${Date.now()})`;
  };

  /** Two rows with different keys want one unique value. The later write keeps it; the other row takes the next free name. Same answer on every computer, since both read the same clocks. */
  function resolveUnique(t: TableInfo, r: RowChange, key: unknown[], win: Record<string, WireCell>, cols: string[]): UniqueClash | null {
    const vals: Record<string, unknown> = {};
    const have = rowOf(t, r.k);
    for (const c of cols) vals[c] = c in win ? fromWire(win[c]!.v) : c in (r.c ?? {}) ? fromWire(r.c[c]!.v) : have?.[c];
    const text = cols.filter((c) => typeof vals[c] === "string" && !t.pk.includes(c));
    if (!text.length) return null;
    const holder = db.all(`SELECT ${t.pk.map(q).join(", ")} FROM ${q(t.name)} WHERE ${cols.map((c) => `${q(c)} IS ?`).join(" AND ")} LIMIT 1`, ...cols.map((c) => vals[c]))[0] as Record<string, unknown> | undefined;
    if (!holder) return null;
    const otherKey = JSON.stringify(t.pk.map((c) => holder[c]));
    if (otherKey === JSON.stringify(key)) return null;
    const col = text[0]!;
    const theirs = (db.all("SELECT hlc FROM peer_clock WHERE tbl = ? AND pk = ? AND col = ?", t.name, otherKey, col)[0] as { hlc?: string } | undefined)?.hlc;
    const mine = win[col]?.h ?? r.c?.[col]?.h ?? "";
    const from = String(vals[col]);
    if (mine && later(mine, theirs)) {
      // the incoming row is the later write: it keeps the name, the row here takes the next free one, and that rename goes back out as this computer's own write
      const to = freeName(t, col, from);
      db.run(`UPDATE ${q(t.name)} SET ${q(col)} = ? WHERE ${t.pk.map((c) => `${q(c)} IS ?`).join(" AND ")}`, to, ...t.pk.map((c) => holder[c]));
      upsertClock(t.name, otherKey, col, tick(), o.site, nextVer());
      db.run("INSERT INTO peer_conflict (tbl, pk, at, kind, detail) VALUES (?, ?, ?, 'renamed', ?)", t.name, otherKey, o.now(), `${col}: ${from} -> ${to}`);
      return { t: t.name, k: r.k, col, from, to, renamed: "local", kept: "both", otherKey };
    }
    const to = freeName(t, col, from);
    db.run("INSERT INTO peer_conflict (tbl, pk, at, kind, detail) VALUES (?, ?, ?, 'renamed', ?)", t.name, r.k, o.now(), `${col}: ${from} -> ${to}`);
    return { t: t.name, k: r.k, col, from, to, renamed: "incoming", kept: "both", otherKey };
  }

  function apply(rows: readonly RowChange[]): ApplyResult {
    const res: ApplyResult = { applied: 0, unchanged: 0, refused: [], conflicts: [] };
    tx(() => {
      stampInside();
      db.run(`UPDATE peer_apply SET "on" = 1 WHERE id = 1`);
      try {
        for (const r of rows) {
          const t = infos.get(r.t);
          if (!t || typeof r.k !== "string") { res.refused.push({ t: String(r.t), k: String(r.k), why: "not a copied table here" }); continue; }
          let key: unknown[];
          try { key = JSON.parse(r.k) as unknown[]; } catch { res.refused.push({ t: r.t, k: r.k, why: "bad key" }); continue; }
          if (!Array.isArray(key) || key.length !== t.pk.length) { res.refused.push({ t: r.t, k: r.k, why: "bad key" }); continue; }
          const local = new Map((db.all("SELECT col, hlc FROM peer_clock WHERE tbl = ? AND pk = ?", r.t, r.k) as { col: string; hlc: string }[]).map((c) => [c.col, c.hlc]));
          const win: Record<string, WireCell> = {};
          for (const [c, cell] of Object.entries(r.c ?? {})) {
            if (!t.tracked.includes(c) || typeof cell?.h !== "string") continue;
            seen(cell.h);
            if (later(cell.h, local.get(c))) win[c] = cell;
          }
          const delWins = typeof r.d === "string" && later(r.d, local.get(DEL));
          if (typeof r.d === "string") seen(r.d);
          if (!Object.keys(win).length && !delWins) { res.unchanged++; continue; }
          // the row's clocks after the merge decide whether it lives
          const merged = new Map(local);
          for (const [c, cell] of Object.entries(win)) merged.set(c, cell.h);
          if (delWins) merged.set(DEL, r.d!);
          const del = merged.get(DEL);
          const cellHlcs = [...merged.entries()].filter(([c]) => c !== DEL).map(([, h]) => h);
          const alive = !del || cellHlcs.some((h) => later(h, del));
          db.exec("SAVEPOINT peer_row");
          try {
            const where = t.pk.map((c) => `${q(c)} IS ?`).join(" AND ");
            const own: Record<string, string> = {};   // cells this computer renamed while resolving a unique clash: they carry a clock of this computer's own
            const write = (): void => {
              const have = rowOf(t, r.k);
              if (!alive) { if (have) db.run(`DELETE FROM ${q(t.name)} WHERE ${where}`, ...key); return; }
              if (have) {
                const cols = Object.keys(win).filter((c) => !t.pk.includes(c));
                if (cols.length) db.run(`UPDATE ${q(t.name)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${where}`, ...cols.map((c) => fromWire(win[c]!.v)), ...key);
                return;
              }
              // the row is new here, or deleted here and written again later there: it comes back with every value the other computer sent
              const vals: Record<string, unknown> = {};
              t.pk.forEach((c, i) => { vals[c] = key[i]; });
              for (const [c, cell] of Object.entries(r.c ?? {})) if (t.tracked.includes(c) && !t.pk.includes(c) && "v" in cell) vals[c] = fromWire(cell.v);
              const cols = Object.keys(vals);
              db.run(`INSERT INTO ${q(t.name)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => vals[c]));
            };
            for (let attempt = 0; ; attempt++) {
              try { write(); break; } catch (e) {
                const clash = /UNIQUE constraint failed: (.+)$/.exec((e as Error).message);
                if (!clash || attempt >= 3) throw e;
                const c = resolveUnique(t, r, key, win, clash[1]!.split(",").map((x) => x.trim().split(".").pop()!));
                if (!c) throw e;
                res.conflicts.push(c);
                if (c.renamed === "incoming") { win[c.col] = { v: c.to, h: tick() }; r.c[c.col] = win[c.col]!; own[c.col] = win[c.col]!.h; }
              }
            }
            const v = nextVer();
            for (const [c, cell] of Object.entries(win)) upsertClock(r.t, r.k, c, cell.h, own[c] ? o.site : parseHlc(cell.h)?.deviceId ?? "", v);
            if (delWins) upsertClock(r.t, r.k, DEL, r.d!, parseHlc(r.d!)?.deviceId ?? "", v);
            db.exec("RELEASE peer_row");
            res.applied++;
          } catch (e) {
            db.exec("ROLLBACK TO peer_row");
            db.exec("RELEASE peer_row");
            // never dropped in silence: the row is kept whole in peer_conflict, and the caller lists it
            const why = (e as Error).message.slice(0, 160);
            db.run("INSERT INTO peer_conflict (tbl, pk, at, kind, detail, row) VALUES (?, ?, ?, 'kept_aside', ?, ?)", r.t, r.k, o.now(), why, JSON.stringify(r));
            res.refused.push({ t: r.t, k: r.k, why });
            res.conflicts.push({ t: r.t, k: r.k, col: "", from: "", to: "", renamed: "none", kept: "aside", why });
          }
        }
      } finally { db.run(`UPDATE peer_apply SET "on" = 0 WHERE id = 1`); }
      if (last) setMeta("hlc", formatHlc(last));
    });
    return res;
  }

  return {
    install, stamp, changes, apply,
    head: () => Number(meta("head") ?? "0"),
    waiting: (cursor) => { stamp(); return Number((db.all("SELECT COUNT(DISTINCT tbl || char(0) || pk) AS n FROM peer_clock WHERE ver > ? AND site = ?", cursor, o.site)[0] as { n: number }).n); },
    cursor: (peer) => Number((db.all("SELECT cursor FROM peer_cursor WHERE peer = ?", peer)[0] as { cursor?: number } | undefined)?.cursor ?? 0),
    setCursor: (peer, cursor) => { db.run("INSERT INTO peer_cursor (peer, cursor, at) VALUES (?, ?, ?) ON CONFLICT(peer) DO UPDATE SET cursor = excluded.cursor, at = excluded.at", peer, cursor, o.now()); },
    tables: () => [...infos.keys()],
  };
}
