// The speed half of resolvers.test.ts (a separate file so only this one is a perf file, ruling 46). A place opens from a populated replica with the network down inside the navigate budget
// of perf/budgets.json: the median against its p50 row, the worst against its p95 row (ruling 43). The correctness half stays in resolvers.test.ts.
// Replica-first screen hooks (P-APP_02): per-capability resolvers answer from SQLite (the generated replica schema on node:sqlite) in the exact shape of the frozen contract; a capability with no
// resolver, or an input the replica cannot answer, falls to the gateway hooks; a pull wakes the query; offline reads work; a place opens inside its first-paint budget.
// @reads /generated/registry.json
// @reads /generated/sync/replica.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { screens } from "../../../../generated/screens.ts";
import type { LiveQuery, ScreenHooks } from "../../fake/live-query.ts";
import { createChangeFeed } from "../changes.ts";
import type { LocalDb, SqlRow, SqlValue } from "../space.ts";
import { RESOLVERS, createReplicaHooks } from "./index.ts";

const ME = "usr_ada";
const SPACE = "spc_real";
const NOW = 1_700_000_000_000;
const screenIndex = new Map(screens.map((s) => [s.id, s]));

// ---- the frozen contract, to check every answer's shape (same small JSON Schema subset the contract tests use)
type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema; items?: Schema; enum?: unknown[]; anyOf?: Schema[]; pattern?: string; minimum?: number; $ref?: string };
interface Registry { $defs: Record<string, Schema>; capabilities: Array<{ name: string; v: number; output: Schema }> }
const registry = JSON.parse(readFileSync(new URL("../../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
function walk(s0: Schema, v: unknown, p: string, out: string[]): void {
  let s = s0;
  for (let i = 0; s.$ref && i < 20; i++) s = registry.$defs[s.$ref.replace("#/$defs/", "")] as Schema;
  if (s.anyOf) { if (!s.anyOf.some((x) => { const e: string[] = []; walk(x, v, p, e); return e.length === 0; })) out.push(`${p || "/"}: matches none of anyOf`); return; }
  if (s.enum && !s.enum.some((x) => x === v)) out.push(`${p || "/"}: not in enum (${String(v)})`);
  const got = typeOf(v);
  if (s.type) { const want = Array.isArray(s.type) ? s.type : [s.type]; if (!want.some((w) => w === got || (w === "number" && got === "integer"))) { out.push(`${p || "/"}: expected ${want.join("|")} got ${got}`); return; } }
  if (typeof v === "string" && s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${p || "/"}: pattern ${s.pattern}`);
  if (typeof v === "number" && s.minimum !== undefined && v < s.minimum) out.push(`${p || "/"}: below minimum`);
  if (Array.isArray(v) && s.items) v.forEach((x, i) => walk(s.items as Schema, x, `${p}/${i}`, out));
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${p}/${k}: required`);
    for (const [k, x] of Object.entries(o)) {
      const sub = s.properties?.[k];
      if (sub) walk(sub, x, `${p}/${k}`, out);
      else if (s.additionalProperties === false) out.push(`${p}/${k}: unknown property`);
    }
  }
}
function errors(cap: string, value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  const out: string[] = [];
  walk(def.output, value, "", out);
  return out;
}

// ---- a real SQLite with the generated replica schema
function open() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../../../generated/sync/replica.sql", import.meta.url), "utf8"));
  const db: LocalDb = { all: (sql, params = []) => sqlite.prepare(sql).all(...(params as SqlValue[])) as unknown as SqlRow[] };
  const insert = (table: string, row: Record<string, SqlValue>): void => {
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  const changes = createChangeFeed();
  return { sqlite, db, insert, changes, store: { spaceId: SPACE, db, changes } };
}
type World = ReturnType<typeof open>;

function seed(w: World, threads = 3, messages = 5): void {
  for (let t = 0; t < threads; t++) {
    const id = `thr_${t}`;
    w.insert("chat_thread", { id, kind: t === 0 ? "chat" : "channel", title: `Thread ${t}`, starter: ME, listed: 1, modePlan: 0, createdAt: NOW + t, version: 1 });
    w.insert("chat_thread_member", { id: `thm_${t}`, thread: id, principal: ME, role: "member", version: 1 });
    w.insert("chat_thread_agent", { id: `tha_${t}`, thread: id, agentId: "agt_intake", mode: "lead", model: "claude-sonnet-5-5", version: 1 });
    for (let m = 0; m < messages; m++) {
      w.insert("chat_message", {
        id: `msg_t${t}m${m}`, thread: id, threadSeq: m + 1, author: m % 2 ? "agt_intake" : ME, kind: m % 2 ? "agent" : "text", body: `Message ${m}`, blocks: "[]", depth: 0, attachments: "[]",
        reactions: "[]", pinned: 0, createdAt: NOW + t * 1000 + m, version: 1,
      });
    }
  }
}

/** Gateway hooks that count what they are asked and never answer (offline). */
function offline(): ScreenHooks & { asked: string[] } {
  const asked: string[] = [];
  const never: LiveQuery<unknown> = { subscribe: () => () => {}, getSnapshot: () => ({ status: "loading" }) };
  return { asked, query(screenId, name) { asked.push(`${screenId}.${name}`); return never; } };
}

const hooksOf = (w: World, gw = offline()) => ({ gw, hooks: createReplicaHooks({ store: w.store, screens: screenIndex, ctx: { spaceId: SPACE, person: ME }, fallback: gw }) });
const ready = <T>(q: LiveQuery<unknown>): T => { const s = q.getSnapshot(); assert.equal(s.status, "ready", "the query is ready"); return (s as { data: T }).data; };

import { loadBudgets } from "../../../../perf/harness/index.ts";

test("place open: a conversation and a list open from a populated replica inside the navigate budget, median against p50 and worst against p95", () => {
  const row = loadBudgets().find((b) => b.id === "navigate");
  assert.ok(row, "perf/budgets.json has a navigate row");
  const w = open(); seed(w, 2000, 10);
  const { hooks } = hooksOf(w);
  const open1 = (): number => {
    const t0 = performance.now();
    ready<{ messages: unknown[] }>(hooks.query("chats.conversation", "messages", { threadId: "thr_1000" }));
    ready<{ threads: unknown[] }>(hooks.query("chats.right-pane", "threads", {}));
    return performance.now() - t0;
  };
  open1();   // warm-up discarded
  const t: number[] = [];
  for (let i = 0; i < 5; i++) { w.changes.emit({ entity: "message", id: `msg_t0m${i}` }); t.push(open1()); }
  t.sort((a, b) => a - b);
  console.log(`METRIC replica.place_open median=${t[2]!.toFixed(2)}ms worst=${t[4]!.toFixed(2)}ms budget_p50=${row.p50} budget_p95=${row.p95} threads=2000 messages=20000`);
  assert.ok(t[2]! <= row.p50, `place open median ${t[2]!.toFixed(2)} ms is over the p50 of ${row.p50} ms`);
  assert.ok(t[4]! <= row.p95, `place open worst ${t[4]!.toFixed(2)} ms is over the p95 of ${row.p95} ms`);
});
