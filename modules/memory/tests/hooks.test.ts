// Memory live in chats (spec 2.15): what the lead agent's captureMode lets a chat leave behind, and the nightly job.
import test from "node:test";
import assert from "node:assert/strict";
import { capture } from "../handlers/facts.ts";
import { nightly } from "../hooks.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const SPEECH = "I prefer short answers. My timezone is Pacific. Remember that invoices go out on Monday.";
const person = { kind: "person", id: "usr_dana" };

function chat(mode: string | null): Parameters<typeof harness>[0] {
  return {
    principal: { kind: "service", id: "svc_host" },
    respond: {
      "threads.get": () => ({ thread: { kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" }] } }),
      "chat.messages.list": () => ({ messages: [{ messageId: "msg_1", author: person, body: SPEECH }] }),
      "memory.capture": () => ({ proposed: 0, merged: 0 }),
      ...(mode ? { "agents.get": () => ({ agent: { captureMode: mode } }) } : {}),
    },
  };
}
const statuses = (h: Harness): string[] => h.rows("SELECT kind, status FROM memory_facts ORDER BY kind").map((r) => `${r["kind"]}:${r["status"]}`);

test("captureMode off keeps nothing and says nothing happened", async () => {
  const h = harness(chat("off"));
  assert.deepEqual(await capture(h.ctx, { threadId: "thr_a", reason: "closed" }), { proposed: 0, merged: 0 });
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  assert.equal(h.named("memory.captured").length, 0);
});

test("captureMode propose leaves every fact, even a low-risk one, for the person to accept", async () => {
  const h = harness(chat("propose"));
  assert.deepEqual(await capture(h.ctx, { threadId: "thr_a", reason: "closed" }), { proposed: 3, merged: 0 });
  assert.deepEqual(statuses(h), ["note:proposed", "preference:proposed", "profile:proposed"]);
});

test("captureMode auto_low_risk merges the low-risk kind and proposes the rest", async () => {
  const h = harness(chat("auto_low_risk"));
  assert.deepEqual(await capture(h.ctx, { threadId: "thr_a", reason: "closed" }), { proposed: 3, merged: 1 });
  assert.deepEqual(statuses(h), ["note:proposed", "preference:current", "profile:proposed"]);
});

test("the nightly job runs maintain once in the small hours, or when a host was off for a day and a half", async () => {
  const h = harness({ ...chat("propose"), respond: { ...chat("propose").respond, "memory.maintain": () => ({ merged: 0, closed: 0, maps: 0 }), "memory.archive_sweep": () => ({ archived: 0, days: 60 }) } });
  const at = (hour: number) => () => hour;
  assert.deepEqual(await nightly(h.ctx as never, at(14)), ["nightly"], "never run: it runs");
  assert.deepEqual(await nightly(h.ctx as never, at(3)), [], "ran just now");
  h.advance(21 * 3_600_000);
  assert.deepEqual(await nightly(h.ctx as never, at(14)), [], "21 hours, in the afternoon: wait for night");
  assert.deepEqual(await nightly(h.ctx as never, at(3)), ["nightly"], "21 hours, at 3: run");
  h.advance(37 * 3_600_000);
  assert.deepEqual(await nightly(h.ctx as never, at(14)), ["nightly"], "37 hours: run whatever the hour");
  assert.equal(h.calls("memory.maintain").length, 3);
  assert.equal(h.calls("memory.archive_sweep").length, 3, "Trash is swept to Archive each night, after upkeep");
});
