// A routine whose runs fail three times in a row for one reason pauses itself, once, with the reason; a success in between starts the count again; it starts again when the cause clears.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { noteRun, resumeSelfPaused, selfPausedReason } from "../routine-guard.ts";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec('CREATE TABLE agents_routine ("id" TEXT PRIMARY KEY, "title" TEXT, "cron" TEXT, "channelId" TEXT, "enabled" INTEGER, "nextRunAt" INTEGER, "updatedAt" INTEGER, "agentId" TEXT DEFAULT \'agt_1\')');
  d.prepare('INSERT INTO agents_routine (id, title, cron, channelId, enabled, nextRunAt, updatedAt) VALUES (?, ?, ?, ?, 1, 5, 0)').run("rtn_1", "Hi every minute", "* * * * *", "thr_1");
  return { all: (sql: string, ...a: unknown[]) => d.prepare(sql).all(...(a as never[])), run: (sql: string, ...a: unknown[]) => ({ changes: Number(d.prepare(sql).run(...(a as never[])).changes) }), raw: d };
}

test("three failed runs in a row for one reason pause the routine once and keep the reason", () => {
  const h = db();
  assert.equal(noteRun(h as never, "rtn_1", false, "engine.vault_locked", "Your Vault is locked", 1), null);
  assert.equal(noteRun(h as never, "rtn_1", false, "engine.vault_locked", "Your Vault is locked", 2), null);
  const p = noteRun(h as never, "rtn_1", false, "engine.vault_locked", "Your Vault is locked", 3)!;
  assert.deepEqual([p.title, p.threadId, p.reason], ["Hi every minute", "thr_1", "Your Vault is locked"]);
  assert.equal((h.all('SELECT enabled FROM agents_routine')[0] as { enabled: number }).enabled, 0);
  assert.equal(selfPausedReason(h as never, "rtn_1"), "Your Vault is locked");
  assert.equal(noteRun(h as never, "rtn_1", false, "engine.vault_locked", "x", 4), null, "already paused: said once");
});

test("a success or a different reason starts the count again", () => {
  const h = db();
  noteRun(h as never, "rtn_1", false, "a", "a", 1); noteRun(h as never, "rtn_1", false, "a", "a", 2);
  assert.equal(noteRun(h as never, "rtn_1", false, "b", "b", 3), null);
  noteRun(h as never, "rtn_1", false, "b", "b", 4);
  assert.equal(noteRun(h as never, "rtn_1", true, "", "", 5), null);
  assert.equal(noteRun(h as never, "rtn_1", false, "b", "b", 6), null);
  assert.equal((h.all('SELECT enabled FROM agents_routine')[0] as { enabled: number }).enabled, 1);
});

test("when the cause clears the routine that paused itself starts again; one a person paused is left alone", () => {
  const h = db();
  for (let i = 1; i <= 3; i++) noteRun(h as never, "rtn_1", false, "x", "boom", i);
  h.raw.prepare("INSERT INTO agents_routine (id, title, cron, channelId, enabled, nextRunAt, updatedAt) VALUES ('rtn_2','Mine','* * * * *','thr_2',0,NULL,0)").run();
  assert.deepEqual(resumeSelfPaused(h as never, 100, () => 160), ["rtn_1"]);
  const rows = h.all("SELECT id, enabled, nextRunAt FROM agents_routine ORDER BY id") as Array<{ id: string; enabled: number; nextRunAt: number | null }>;
  assert.deepEqual(rows.map((r) => [r.id, r.enabled, r.nextRunAt]), [["rtn_1", 1, 160], ["rtn_2", 0, null]]);
});

test("a turn completed by one agent starts only that agent's routines that paused themselves", () => {
  const h = db();
  h.raw.prepare("INSERT INTO agents_routine (id, title, cron, channelId, enabled, nextRunAt, updatedAt, agentId) VALUES ('rtn_3','Other','* * * * *','thr_3',1,5,0,'agt_2')").run();
  for (let i = 1; i <= 3; i++) { noteRun(h as never, "rtn_1", false, "x", "boom", i); noteRun(h as never, "rtn_3", false, "x", "boom", i); }
  assert.deepEqual(resumeSelfPaused(h as never, 100, () => 160, "agt_2"), ["rtn_3"]);
  assert.equal(selfPausedReason(h as never, "rtn_1"), "boom", "the other agent's routine stays paused");
  assert.deepEqual(resumeSelfPaused(h as never, 100, () => 160, "agt_1"), ["rtn_1"]);
});
