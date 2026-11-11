// Connected, not only built (f-wire, 12 Nov): an event the fanout knows how to file is one it is subscribed to, and every event a manifest says files a notification kind has a path
// that files it. A branch of plan() for an event the consumer does not read never runs: hook.admin_asked had one, so "Ask an admin" from a hook's stop line reached no admin.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { harness } from "../fixtures/db.ts";
import { alice, as, bob, cara, svc } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";

const implSource = fs.readFileSync(fileURLToPath(new URL("../impl.ts", import.meta.url)), "utf8");
const fanOn = new Set<string>(consumers["notifications.fanout"].on);

/** The events plan() has a branch for: each `e.name === "..."` and the TASK_EVENTS set. */
function planned(src: string): string[] {
  const body = src.slice(src.indexOf("export function plan("), src.indexOf("export const consumers"));
  const names = new Set([...body.matchAll(/e\.name === "([a-z_]+\.[a-z_.]+)"/g)].map((m) => m[1]!));
  const tasks = /const TASK_EVENTS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "";
  for (const m of tasks.matchAll(/"([a-z_]+\.[a-z_.]+)"/g)) names.add(m[1]!);
  return [...names].sort();
}

test("every event the fanout has a plan for is an event the fanout consumer reads", () => {
  const names = planned(implSource);
  assert.ok(names.length >= 15, `found the plan branches (${names.length})`);
  assert.deepEqual(names.filter((n) => !fanOn.has(n)), [], "a plan branch for an event the consumer never receives files nothing");
});

test("Ask an admin from a hook's stop line files a hook.asked line for every admin but the one who asked", async () => {
  const h = harness();
  h.callee("access.roles.list", () => ({ roles: [{ id: "rol_admin", name: "Admin", permissions: [] }] }));
  h.callee("access.roles.get", () => ({ holders: [{ kind: "person", id: alice.id }, { kind: "person", id: bob.id }, { kind: "person", id: cara.id }] }));
  const ev = { name: "hook.admin_asked", subject: "thread/thr_1", id: "evt_1", payload: { hookId: "hok_1", threadId: "thr_1", line: "A hook stopped a send", by: cara.id, note: "Can I send this?" } };
  assert.ok(fanOn.has(ev.name), "the fanout reads hook.admin_asked");
  const ids = await consumers["notifications.fanout"].run(h.ctxFor(null, as(svc)), ev as never);
  const rows = ids.map((id) => h.sqlite.prepare("SELECT person, kind, title FROM notifications_items WHERE id = ?").get(id) as { person: string; kind: string; title: string });
  assert.deepEqual(rows.map((r) => r.person).sort(), [alice.id, bob.id].sort(), "every admin, not the asker");
  assert.ok(rows.every((r) => r.kind === "hook.asked"));
  assert.match(rows[0]!.title, /A hook stopped a send: Can I send this\?/);
});

/**
 * Events whose manifest names a notification kind (`notify:`) and that something other than the fanout files: the module that emits them sends the notification itself.
 * Each entry names the file that sends it; the test reads that file for the kind.
 */
const FILED_DIRECTLY: Record<string, string> = {
  "access.requested": "modules/access/handlers/request.ts",
  "agent.blocked": "modules/agents/handlers/crud.ts",
  "agent.limit_hit": "modules/automations/schedule/schedule.ts",
  "agent.task_finished": "modules/engine/handlers/extra/turns.ts",
  "call.ringing": "modules/notifications/handlers/deliver.ts",
  "conversation.reply_received": "modules/notifications/handlers/deliver.ts",
  "thread.replied": "modules/notifications/handlers/deliver.ts",
  "digest.written": "modules/home/handlers/digest.ts",
  "message.direct": "modules/chat/handlers/notify.ts",
  "message.mentioned": "modules/chat/handlers/notify.ts",
  "vault.rotation_due": "modules/notifications/handlers/rules.ts",
};

/**
 * Known gaps, found by the f-wire sweep on 12 Nov 2026 and left for the lead: the manifest says the event files this kind, Settings shows the kind's switch, and nothing files it.
 * Who should receive each (admins, the incident owner, the connection owner) is a product decision. Remove an entry when it is wired; the test fails while an entry is already covered.
 */
const NOT_YET_FILED: readonly string[] = [
  "backup.failed", "health.changed", "network.certificate_failed", "update.failed", "sandbox.denied",
  "incident.opened", "incident.assigned",
  "report.submitted", "report.resolved",
  "conflict.confirmation_needed", "sync.conflict",
  "connection.needs_reconnect", "connector.publish_failed", "mailbox.sync_failed", "mount.conflict", "mount.failed", "source.link_pending", "source.mapping_failed",
  "sync.deletes_paused", "sync.op_rejected", "sync.push_failed", "sync.schema_changed",
  "import.failed", "site.build_failed",
];

test("every event a manifest says files a notification is read by the fanout, filed by its own module, or listed as a known gap", () => {
  const notifying = registry.events.filter((e) => typeof (e as { notify?: unknown }).notify === "string") as Array<{ name: string; notify: string }>;
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const unaccounted: string[] = [];
  for (const e of notifying) {
    if (fanOn.has(e.name)) continue;
    const file = FILED_DIRECTLY[e.name];
    if (file) {
      const src = fs.readFileSync(`${root}${file}`, "utf8");
      assert.ok(src.includes(`"${e.notify}"`), `${file} files ${e.notify} for ${e.name}`);
      continue;
    }
    if (NOT_YET_FILED.includes(e.name)) continue;
    unaccounted.push(`${e.name} (notify: ${e.notify})`);
  }
  assert.deepEqual(unaccounted, [], "a new event that names a kind needs a path that files it");
  for (const n of NOT_YET_FILED) {
    assert.ok(notifying.some((e) => e.name === n), `${n} still names a kind`);
    assert.ok(!fanOn.has(n), `${n} is wired now: take it off NOT_YET_FILED`);
  }
});
