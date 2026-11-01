// Event triggers on a booted daemon: a Flow that makes the record it listens for runs once; two Flows that trigger each other stop at the chain depth; and a bulk import cannot start thousands of Runs
// (the Flow pauses past a burst and its owner gets a Needs you note).
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, seededDir } from "./memory-live-kit.ts";
import { resetBursts } from "../modules/automations/handlers/triggers.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ft-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const settle = async (d: Daemon, ms = 6000): Promise<void> => { for (let i = 0; i < ms / 150; i++) { await d.hooks?.pump?.(); await new Promise((r) => setTimeout(r, 150)); } };
const names = async (d: Daemon): Promise<string[]> => ((await call(d, "records.query", { type: "contact" })).data.rows as Array<{ fields: { name?: string } }>).map((r) => String(r.fields.name));

test("a Flow that makes the record it listens for runs once, not for ever (self-trigger is dropped)", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const def = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }], nodes: [{ id: "more", key: "records.create", title: "Make a follow-up contact", input: { type: "contact", fields: { name: "Follow-up" } } }] };
    const id = (await ok(d, "automations.create", { name: "Echo", definition: def })).automation.id as string;
    await ok(d, "automations.set_enabled", { automationId: id, enabled: true });
    await ok(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } });
    for (let i = 0; i < 40; i++) { await d.hooks?.pump?.(); await new Promise((r) => setTimeout(r, 150)); }
    const rows = (await call(d, "records.query", { type: "contact" })).data.rows as Array<{ fields: { name?: string } }>;
    assert.equal(rows.filter((r) => r.fields.name === "Follow-up").length, 1, "one follow-up, then the chain stops");
  } finally { await d.stop(); }
});

test("two Flows that trigger each other stop at the chain depth instead of for ever", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    // A: when a contact is updated, make a contact. B: when a contact is created, update it. Each makes the other fire.
    const a = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "updated" } }], nodes: [{ id: "a1", key: "records.create", title: "Make a contact", input: { type: "contact", fields: { name: "From A" } } }] };
    const b = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }], nodes: [{ id: "b1", key: "records.update", title: "Touch it", input: { type: "contact", recordId: "{{ trigger.recordId }}", patch: { name: "Touched" } } }] };
    for (const [name, definition] of [["A", a], ["B", b]] as const) {
      const id = (await ok(d, "automations.create", { name, definition })).automation.id as string;
      await ok(d, "automations.set_enabled", { automationId: id, enabled: true });
    }
    await ok(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } });
    await settle(d, 12_000);
    const all = await names(d);
    assert.ok(all.length <= 12, `the chain stopped: ${all.length} contacts`);
    assert.ok(all.length >= 3, `and it did run: ${all.length} contacts`);
  } finally { await d.stop(); }
});

test("a bulk import cannot start thousands of Runs: past a burst the Flow pauses and its owner gets a note", async () => {
  resetBursts();
  const d = await boot(seededDir());
  try {
    await connect(d);
    const def = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }], nodes: [{ id: "t", key: "create_task", title: "Call", input: { title: "Call the lead", assigned: { kind: "person", id: "usr_olivia" } } }] };
    const id = (await ok(d, "automations.create", { name: "Call every lead", definition: def })).automation.id as string;
    await ok(d, "automations.set_enabled", { automationId: id, enabled: true });
    for (let i = 0; i < 130; i++) await ok(d, "records.create", { type: "contact", fields: { name: `Lead ${i}` } });
    await settle(d, 15_000);
    const a = (await ok(d, "automations.get", { automationId: id })).automation;
    assert.equal(a.status, "paused", "the Flow paused itself");
    assert.match(a.pausedReason, /more than 100 starts in a minute/);
    const tasks = (await call(d, "tasks.list", { scope: "all" })).data.tasks as Array<{ title: string }>;
    assert.ok(tasks.filter((t) => t.title === "Call the lead").length <= 101, "at most a burst of Runs started");
    assert.ok(tasks.some((t) => t.title === "Call every lead was paused"), "the owner has a note saying so");
  } finally { await d.stop(); }
});
