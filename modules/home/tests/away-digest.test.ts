// The While you were away writer (owner D21, 3 Nov): Vyre writes the digest itself, with no model, when a person comes back after an absence (devices.touch) or presses I'm Back.
// It names people, never ids; nothing new writes nothing, so the row in Chats shows only after an absence that had something in it; a second ask for the same absence writes once.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, hex, NOW, HOUR } from "../fixtures/seed.ts";

function quiet(h: Harness): void {
  h.callee("runs.list", () => ({ runs: [] }));
  h.callee("follows.list", () => ({ follows: [] }));
  h.callee("tasks.my_work", () => ({ tasks: [{ id: hex("tsk", 1), title: "Review the engagement letter", state: "todo", updatedAt: NOW - HOUR }] }));
  h.callee("notifications.digest.collect", () => ({ items: [] }));
  h.callee("access.principals.get", (i) => ({ principal: { id: i.principal.id, name: "Dan Diaz" } }));
}

test("nothing happened while away: no digest, even with a task waiting", async () => {
  const h = harness();
  quiet(h);
  const out = await h.call("home.away_digest", { since: NOW - 6 * HOUR }, alice);
  assert.deepEqual(out, { items: 0 });
  assert.equal((await h.call("home.digest", {}, alice)).digest, null, "no row in Chats");
});

test("after an absence: a capped agent message, a join and a record change, by name; then it resets once seen, and the same absence writes once", async () => {
  const h = harness();
  quiet(h);
  h.callee("notifications.digest.collect", (i) => {
    assert.equal(i.person, alice.id);
    return { items: [
      { kind: "agent.task_finished", title: "Intake finished: Smith intake", at: NOW - 2 * HOUR, count: 1 },
      { kind: "member.joined", title: "Eve Evans joined Northwind", at: NOW - 3 * HOUR, count: 1 },
      { kind: "member.joined", title: "usr_9f2 joined Northwind", at: NOW - 3 * HOUR, count: 1 },
      { kind: "digest.away", title: "While you were away", at: NOW - HOUR, count: 1 },
    ] };
  });
  h.callee("follows.list", () => ({ follows: [{ resource: { type: "record", id: hex("rec", 1) }, title: "Smith matter" }] }));
  h.callee("events.list", () => ({ events: [{ id: hex("evt", 1), type: "record.updated", at: NOW - 4 * HOUR, actor: "usr_dan" }] }));
  const out = await h.call("home.away_digest", { since: NOW - 6 * HOUR }, alice);
  assert.equal(out.items, 4, "three things happened, and the task still waiting comes last");
  const d = (await h.call("home.digest", {}, alice)).digest;
  assert.ok(d, "written");
  assert.equal(d.builtBy, "vyre");
  assert.equal(d.periodStart, NOW - 6 * HOUR);
  assert.deepEqual(d.items.map((i: { kind: string; title: string; line: string }) => `${i.kind}:${i.title}:${i.line}`), [
    "record_change:Smith matter:Changed by Dan Diaz.",
    "notice:Intake finished: Smith intake:Finished.",
    "notice:Eve Evans joined Northwind:Joined the Space.",
    "waiting:Review the engagement letter:Waiting on you.",
  ]);
  assert.ok(!/usr_|agt_/.test(JSON.stringify(d.items)), "names, never ids: a line that would show an id is left out");
  assert.match(d.headline[0], /^3 things happened while you were away\.$/);
  const again = await h.call("home.away_digest", { since: NOW - 6 * HOUR }, alice);
  assert.equal(again.digestId, out.digestId, "the same absence writes once");
  await h.call("home.mark_digest_seen", { digestId: d.id }, alice);
  assert.equal((await h.call("home.digest", {}, alice)).digest, null, "it resets once seen");
});
