// A real SQLite database for spaces tests (node:sqlite), loaded from the module's own migration.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Db, SpacesCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;

export class SqliteDb implements Db {
  readonly raw = new DatabaseSync(":memory:");
  constructor() { this.raw.exec(readFileSync(new URL("../migrations/0001_spaces.sql", import.meta.url), "utf8")); }
  all(sql: string, ...args: unknown[]): unknown[] { return this.raw.prepare(sql).all(...(args as never[])); }
  run(sql: string, ...args: unknown[]): { changes: number } { return { changes: Number(this.raw.prepare(sql).run(...(args as never[])).changes) }; }
}

/** One Space server: its own database, clock and event log. */
export function harness(space = "spc_north", name = "Northwind", kind: "team" | "personal" = "team", now = NOW) {
  const db = new SqliteDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  let clock = now;
  db.run(`INSERT INTO spaces_profile (id, name, logo_file_id, kind) VALUES (?, ?, ?, ?)`, space, name, null, kind);
  const base = {
    space,
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db,
    emit(n: string, subject: string, payload: unknown) { events.push({ name: n, subject, payload }); },
  };
  const as = (id: string): SpacesCtx => ({ ...base, principal: { kind: "person", id } });
  return { db, events, as, base, anon: base as SpacesCtx, advance(ms: number) { clock += ms; } };
}

export function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  return (e as { error?: { code?: string } }).error?.code;
}
