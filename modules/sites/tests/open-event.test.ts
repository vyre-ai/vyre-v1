// An artifact an agent publishes during a person's turn opens in that person's app, in a new tab, only when their app said the chat is open. The app says so with sites.chat_viewing (every
// half minute); the publish marks the card in the chat for that person (openFor), the open chat opens the tab from it, and `opened` is true only then. A chat that is not open gets the card
// alone, `opened` is false, and the agent's words follow the flag (agent/skills/artifacts/SKILL.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { registry } from "../../../generated/registry.ts";
import { configureRoutes } from "../handlers/route.ts";
import { forgetViewing, VIEWING_MS } from "../handlers/viewing.ts";
import { handlers } from "../impl.ts";
import { harness as base } from "../fixtures/world.ts";

const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>;

function world() {
  const w = base();
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_sites_core.sql", "0002_promote_tables.sql", "0003_routes.sql"]) db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const posted: { threadId: string; blocks: { type: string; data: Record<string, unknown> }[] }[] = [];
  const dbx = { all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])), run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }) };
  const call = async (cap: string, input: unknown): Promise<unknown> => { if (cap === "chat.post") { posted.push(input as never); return { message: { messageId: "msg_1" } }; } return w.ctx.call(cap as never, input as never); };
  const person = { ...w.ctx, principal: { kind: "person", id: "usr_noah" }, db: dbx, call };
  const agent = { ...person, principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_noah", thread: "thr_1" };
  return { w, person, agent, posted, call };
}
const host = { origin: () => ({ origin: "https://harbor.vyre.run", relay: true }), probe: async () => ({ answering: true }), artifacts: { folder: async () => "fld_art", put: async () => undefined } };

test("the app says the chat is open; the agent's publish marks the card for the asker and says opened", async () => {
  forgetViewing();
  const { person, agent, posted } = world();
  configureRoutes(host as never);
  try {
    assert.deepEqual(await h["sites.chat_viewing"]!(person, { threadId: "thr_1" }), { ok: true });
    const out = await h["sites.artifact_publish"]!(agent, { title: "Numbers", html: "<p>hi</p>" });
    assert.equal(out.opened, true);
    assert.deepEqual(posted[0]!.blocks[0]!.data, { artifactId: out.artifactId, title: "Numbers", openFor: "usr_noah" });
  } finally { configureRoutes(null); }
});

test("the chat is not open: the card only, opened is false", async () => {
  forgetViewing();
  const { person, agent, posted } = world();
  configureRoutes(host as never);
  try {
    const out = await h["sites.artifact_publish"]!(agent, { title: "Numbers", html: "<p>hi</p>" });
    assert.equal(out.opened, false);
    assert.equal(posted[0]!.blocks[0]!.data["openFor"], undefined);
    // another chat open does not count, nor does another person's, nor a report that has gone stale
    await h["sites.chat_viewing"]!(person, { threadId: "thr_other" });
    await h["sites.chat_viewing"]!({ ...person, principal: { kind: "person", id: "usr_sam" } }, { threadId: "thr_1" });
    assert.equal((await h["sites.artifact_publish"]!(agent, { title: "Numbers 2", html: "<p>2</p>" })).opened, false);
    await h["sites.chat_viewing"]!(person, { threadId: "thr_1" });
    const later = { ...agent, now: () => person.now() + VIEWING_MS + 1 };
    assert.equal((await h["sites.artifact_publish"]!(later, { title: "Numbers 3", html: "<p>3</p>" })).opened, false, "the chat was closed a while ago");
  } finally { configureRoutes(null); }
});

test("a republish in the open chat marks the card again; a person publishing for themselves, or a card that was not posted, is never opened", async () => {
  forgetViewing();
  const { person, agent, posted, call } = world();
  configureRoutes(host as never);
  try {
    await h["sites.chat_viewing"]!(person, { threadId: "thr_1" });
    const first = await h["sites.artifact_publish"]!(agent, { title: "Numbers", html: "<p>1</p>" });
    const again = await h["sites.artifact_publish"]!(agent, { title: "Numbers", html: "<p>2</p>" });
    assert.equal(again.artifactId, first.artifactId);
    assert.deepEqual([first.opened, again.opened, again.updated], [true, true, true]);
    assert.equal(posted.length, 2);
    assert.equal((await h["sites.artifact_publish"]!({ ...person, thread: "thr_1" }, { title: "Mine", html: "<p>m</p>" })).opened, false, "a person has their own press: no one to open it for");
    const closed = { ...agent, async call(cap: string, input: unknown) { if (cap === "chat.post") throw new VyreErr({ code: "validation.precondition_failed", message: "closed", retryable: false, traceId: "t", next: [] } as never); return call(cap, input); } };
    assert.equal((await h["sites.artifact_publish"]!(closed, { title: "Lost", html: "<p>l</p>" })).opened, false, "no card went out, so nothing opens");
  } finally { configureRoutes(null); }
});

test("sites.chat_viewing is a write on the thread at view level, offline-safe to skip, and only a person's app reports", () => {
  const cap = registry.capabilities.find((c) => c.name === "sites.chat_viewing") as unknown as { effects: string; level?: string };
  assert.ok(cap, "declared");
  assert.equal(cap.level, "view");
});
