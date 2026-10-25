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
        id: `msg_${t}_${m}`, thread: id, threadSeq: m + 1, author: m % 2 ? "agt_intake" : ME, kind: m % 2 ? "agent" : "text", body: `Message ${m}`, blocks: "[]", depth: 0, attachments: "[]",
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

test("chat reads answer from SQLite in the exact contract shape: threads.get, chat.messages.list, threads.list", () => {
  const w = open(); seed(w);
  const { gw, hooks } = hooksOf(w);
  const thread = ready<{ thread: Record<string, unknown> }>(hooks.query("chats.conversation", "thread", { threadId: "thr_1" }));
  assert.deepEqual(errors("threads.get", thread), []);
  assert.equal(thread.thread["replyCount"], 5);
  assert.deepEqual((thread.thread["agents"] as unknown[])[0], { agentId: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" });

  const messages = ready<{ messages: Array<{ threadSeq: number; enc: number }>; hasMore: boolean }>(hooks.query("chats.conversation", "messages", { threadId: "thr_0" }));
  assert.deepEqual(errors("chat.messages.list", messages), []);
  assert.deepEqual(messages.messages.map((m) => m.threadSeq), [1, 2, 3, 4, 5], "oldest first");
  assert.equal(messages.messages[0]?.enc, 2, "a private chat is enc 2");
  const older = ready<{ messages: Array<{ threadSeq: number }> }>(hooks.query("chats.conversation", "messages", { threadId: "thr_1", before: 3 }));
  assert.deepEqual(older.messages.map((m) => m.threadSeq), [1, 2]);

  const kids = ready<{ threads: Array<{ threadId: string }>; total: number }>(hooks.query("chats.right-pane", "threads", { threadId: "thr_none" }));
  assert.deepEqual(errors("threads.list", kids), []);
  assert.equal(kids.threads.length, 0);
  assert.deepEqual(gw.asked, [], "none of it touched the gateway");
});

test("stars, calendars, events and notifications answer from SQLite in the contract shape", () => {
  const w = open(); seed(w, 2, 1);
  w.insert("spaces_star", { id: "str_thread.thr_1", person: ME, resourceType: "thread", resourceId: "thr_1", createdAt: NOW + 5, version: 1 });
  w.insert("spaces_star", { id: "str_file.fil_x", person: ME, resourceType: "file", resourceId: "fil_x", createdAt: NOW + 9, version: 1 });
  w.insert("calendar_list", { id: "cld_work", title: "Work", color: "#4f6bed", provider: "google", ownerId: ME, personal: 0, state: "syncing", version: 1 });
  w.insert("calendar_list", { id: "cld_me", title: "Personal", provider: "local", ownerId: ME, personal: 1, state: "syncing", version: 1 });
  w.insert("calendar_event", {
    id: "cev_1", calendarId: "cld_work", title: "Hearing", startsAt: NOW + 1000, endsAt: NOW + 2000, allDay: 0, joinProvider: "zoom", attendees: `[{"email":"a@example.com"}]`, recordIds: "[]", status: "confirmed", version: 1,
  });
  w.insert("calendar_event", { id: "cev_far", calendarId: "cld_work", title: "Later", startsAt: NOW + 900_000, endsAt: NOW + 901_000, allDay: 0, recordIds: "[]", attendees: "[]", version: 1 });
  w.insert("notifications_items", { id: "ntf_1", person: ME, kind: "task.assigned", level: "badge", place: "inbox", title: "A task", subject_type: "task", subject_id: "tsk_1", count: 2, at: NOW, actions: "[]", version: 1 });
  w.insert("notifications_items", { id: "ntf_2", person: "usr_other", kind: "task.assigned", level: "badge", place: "inbox", title: "Not mine", count: 1, at: NOW, actions: "[]", version: 1 });
  const { gw, hooks } = hooksOf(w);

  const stars = ready<{ stars: Array<{ title: string; resource: { type: string } }> }>(hooks.query("home.today-starred-ask", "stars"));
  assert.deepEqual(errors("stars.list", stars), []);
  assert.deepEqual(stars.stars.map((s) => s.title), ["fil_x", "Thread 1"], "newest first; a title the replica holds is used, else the id");

  const cals = ready<{ calendars: Array<{ id: string }> }>(hooks.query("calendar.view", "calendars"));
  assert.deepEqual(errors("calendar.list_calendars", cals), []);
  assert.deepEqual(cals.calendars.map((c) => c.id), ["cld_me", "cld_work"]);

  const events = ready<{ events: Array<{ id: string }>; total: number }>(hooks.query("calendar.view", "events", { from: NOW, to: NOW + 10_000 }));
  assert.deepEqual(errors("calendar.list_events", events), []);
  assert.deepEqual(events.events.map((e) => e.id), ["cev_1"], "only events overlapping the range");

  const note = ready<{ notifications: Array<{ id: string; spaceId: string; subject?: unknown }> }>(hooks.query("notifications.banner", "list", {}));
  assert.deepEqual(errors("notifications.list", note), []);
  assert.deepEqual(note.notifications.map((n) => n.id), ["ntf_1"], "only mine");
  assert.equal(note.notifications[0]?.spaceId, SPACE);
  assert.deepEqual(gw.asked, []);
});

test("a capability with no resolver, and an input the replica cannot answer, go to the gateway hooks", () => {
  const w = open(); seed(w, 1, 1);
  const { gw, hooks } = hooksOf(w);
  assert.equal(hooks.local("chat.recent"), false, "unread counts are server state: chat.recent stays on the gateway");
  hooks.query("chats.sidebar", "recent", {}).getSnapshot();
  hooks.query("chats.conversation", "thread", { threadId: "thr_unknown" }).getSnapshot();
  hooks.query("chats.conversation", "messages", { threadId: "thr_unknown" }).getSnapshot();
  assert.deepEqual(gw.asked, ["chats.sidebar.recent", "chats.conversation.thread", "chats.conversation.messages"]);
});

test("a row pulled into the replica wakes the query that read it, and a gateway answer takes over while the replica has a miss", () => {
  const w = open(); seed(w, 1, 2);
  const remoteSnap = { status: "ready" as const, data: { thread: { threadId: "thr_9", from: "gateway" } } };
  const gw: ScreenHooks = { query: () => ({ subscribe: () => () => {}, getSnapshot: () => remoteSnap }) };
  const hooks = createReplicaHooks({ store: w.store, screens: screenIndex, ctx: { spaceId: SPACE, person: ME }, fallback: gw });

  const q = hooks.query("chats.conversation", "messages", { threadId: "thr_0" });
  let woken = 0;
  const off = q.subscribe(() => { woken++; });
  assert.equal(ready<{ messages: unknown[] }>(q).messages.length, 2);
  const snap = q.getSnapshot();
  assert.strictEqual(q.getSnapshot(), snap, "no change, same snapshot object");
  w.insert("chat_message", { id: "msg_new", thread: "thr_0", threadSeq: 3, author: ME, kind: "text", body: "Pulled", blocks: "[]", depth: 0, attachments: "[]", reactions: "[]", pinned: 0, createdAt: NOW + 50, version: 1 });
  w.changes.emit({ entity: "message", id: "msg_new" });
  assert.equal(woken, 1);
  assert.equal(ready<{ messages: unknown[] }>(q).messages.length, 3);
  w.changes.emit({ entity: "star", id: "str_x" });
  assert.equal(woken, 1, "a star change never woke a chat query");
  off();

  const miss = hooks.query("chats.conversation", "thread", { threadId: "thr_9" });
  assert.deepEqual(miss.getSnapshot(), remoteSnap, "a thread this device does not hold is the gateway's answer");
  w.insert("chat_thread", { id: "thr_9", kind: "channel", title: "Arrived", listed: 1, modePlan: 0, createdAt: NOW, version: 1 });
  w.changes.emit({ entity: "thread", id: "thr_9" });
  assert.equal(ready<{ thread: { title: string } }>(miss).thread.title, "Arrived", "once the pull lands the replica answers");
});

test("place open: a conversation and a list open from a populated replica inside the first-paint budget with the network down", () => {
  const w = open(); seed(w, 2000, 10);
  const { gw, hooks } = hooksOf(w);
  const open1 = (): number => {
    const t0 = performance.now();
    const msgs = ready<{ messages: unknown[] }>(hooks.query("chats.conversation", "messages", { threadId: "thr_1000" }));
    const list = ready<{ threads: unknown[] }>(hooks.query("chats.right-pane", "threads", {}));
    assert.equal(msgs.messages.length, 10);
    assert.ok(list.threads.length > 0);
    return performance.now() - t0;
  };
  open1();   // warm-up discarded
  const t: number[] = [];
  for (let i = 0; i < 5; i++) { w.changes.emit({ entity: "message", id: `msg_${i}` }); t.push(open1()); }
  t.sort((a, b) => a - b);
  console.log(`METRIC replica.place_open median=${t[2]!.toFixed(2)}ms worst=${t[4]!.toFixed(2)}ms threads=2000 messages=20000`);
  assert.ok(t[4]! < 50, `place open took ${t[4]!.toFixed(2)} ms against a 50 ms first paint`);
  assert.deepEqual(gw.asked, [], "the network was not asked");
});

test("the resolver table names each capability once and every one is in the registry with an output", () => {
  const caps = RESOLVERS.map((r) => r.cap);
  assert.equal(new Set(caps).size, caps.length);
  for (const c of caps) assert.ok(registry.capabilities.some((x) => x.name === c), `${c} is a real capability`);
});
