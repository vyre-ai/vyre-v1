// Connected, not only built (f-wire, 12 Nov): an event the fanout knows how to file is one it is subscribed to, and every event a manifest says files a notification kind has a path
// that files it. A branch of plan() for an event the consumer does not read never runs: hook.admin_asked had one, so "Ask an admin" from a hook's stop line reached no admin.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, as, bob, bot, cara, svc } from "../fixtures/seed.ts";
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
  assert.deepEqual(
    names.filter((n) => !fanOn.has(n)),
    [],
    "a plan branch for an event the consumer never receives files nothing",
  );
});

test("Ask an admin from a hook's stop line files a hook.asked line for every admin but the one who asked", async () => {
  const h = harness();
  h.callee("access.roles.list", () => ({ roles: [{ id: "rol_admin", name: "Admin", permissions: [] }] }));
  h.callee("access.roles.get", () => ({
    holders: [
      { kind: "person", id: alice.id },
      { kind: "person", id: bob.id },
      { kind: "person", id: cara.id },
    ],
  }));
  const ev = {
    name: "hook.admin_asked",
    subject: "thread/thr_1",
    id: "evt_1",
    payload: {
      hookId: "hok_1",
      threadId: "thr_1",
      line: "A hook stopped a send",
      by: cara.id,
      note: "Can I send this?",
    },
  };
  assert.ok(fanOn.has(ev.name), "the fanout reads hook.admin_asked");
  const ids = await consumers["notifications.fanout"].run(h.ctxFor(null, as(svc)), ev as never);
  const rows = ids.map(
    (id) =>
      h.sqlite.prepare("SELECT person, kind, title FROM notifications_items WHERE id = ?").get(id) as {
        person: string;
        kind: string;
        title: string;
      },
  );
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
  // the import's own Run fails with it (runs.finish), and run.failed reaches the Run's owner through the fanout: a second line would repeat it
  "import.failed": "modules/runs/handlers/engine.ts",
};

/**
 * Known gaps (f-wire, 12 Nov 2026, wired the rest on the lead's decision): the manifest says the event files this kind and nothing files it, each with why. A kind only these name has no
 * switch in Settings (UNSENT_KINDS). Remove an entry when it is wired; the test fails while an entry is already covered.
 */
const NOT_YET_FILED: readonly string[] = [
  // nothing emits it
  "sandbox.denied",
  // the review task they open already reaches the admins through task.requested; a second line would say the same thing twice
  "report.submitted",
  "conflict.confirmation_needed",
  // the payload names nobody to tell (the reporter, the record's people, the mailbox's people): a product decision
  "report.resolved",
  "sync.conflict",
  "mailbox.sync_failed",
];

test("every event a manifest says files a notification is read by the fanout, filed by its own module, or listed as a known gap", () => {
  const notifying = registry.events.filter((e) => typeof (e as { notify?: unknown }).notify === "string") as Array<{
    name: string;
    notify: string;
  }>;
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
    assert.ok(
      notifying.some((e) => e.name === n),
      `${n} still names a kind`,
    );
    assert.ok(!fanOn.has(n), `${n} is wired now: take it off NOT_YET_FILED`);
  }
});

test("Settings hides exactly the kinds that nothing files: a kind that starts being sent comes back to the page", () => {
  const app = fs.readFileSync(
    fileURLToPath(new URL("../../../apps/app/src/places/settings/pages-a.tsx", import.meta.url)),
    "utf8",
  );
  const hidden = new Set(
    [...(/UNSENT_KINDS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(app)?.[1] ?? "").matchAll(/"([a-z_.]+)"/g)].map(
      (m) => m[1]!,
    ),
  );
  assert.ok(hidden.size > 0, "found the hidden kinds in Settings");
  const notifying = registry.events.filter((e) => typeof (e as { notify?: unknown }).notify === "string") as Array<{
    name: string;
    notify: string;
  }>;
  const filedKinds = new Set(
    notifying.filter((e) => fanOn.has(e.name) || FILED_DIRECTLY[e.name] !== undefined).map((e) => e.notify),
  );
  for (const k of hidden)
    assert.ok(!filedKinds.has(k), `${k} is filed now (an event that names it is read or sent): show its switch again`);
  const onlyGaps = new Set(
    notifying
      .filter((e) => NOT_YET_FILED.includes(e.name))
      .map((e) => e.notify)
      .filter((k) => !filedKinds.has(k)),
  );
  for (const k of onlyGaps)
    assert.ok(hidden.has(k), `${k} is named only by events nothing files: hide its switch (UNSENT_KINDS)`);
});

test("the lines the lead's decision wired (12 Nov): health and sync trouble to every admin, an incident to its owner, a failed site build to who started it (a failed import is told by its Run)", async () => {
  const h = harness();
  h.callee("access.roles.list", () => ({ roles: [{ id: "rol_admin", name: "Admin", permissions: [] }] }));
  h.callee("access.roles.get", () => ({
    holders: [
      { kind: "person", id: alice.id },
      { kind: "person", id: bob.id },
    ],
  }));
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, as(svc));
  const rows = (ids: string[]): Array<{ person: string; kind: string; title: string }> =>
    ids.map(
      (id) =>
        h.sqlite.prepare("SELECT person, kind, title FROM notifications_items WHERE id = ?").get(id) as {
          person: string;
          kind: string;
          title: string;
        },
    );
  const run = async (name: string, payload: Record<string, unknown>, actor?: string) =>
    rows(await fan.run(ctx, { name, subject: "", id: `evt_${name}`, payload, ...(actor ? { actor } : {}) } as never));
  for (const name of [
    "health.changed",
    "backup.failed",
    "incident.opened",
    "site.build_failed",
    "connection.needs_reconnect",
    "sync.op_rejected",
  ])
    assert.ok(fanOn.has(name), `the fanout reads ${name}`);
  const down = await run("health.changed", { key: "access.projection", from: "healthy", to: "down" });
  assert.deepEqual(
    down.map((r) => [r.person, r.kind, r.title]).sort(),
    [
      [alice.id, "health.degraded", "Access projections is down"],
      [bob.id, "health.degraded", "Access projections is down"],
    ].sort(),
  );
  assert.deepEqual(
    await run("health.changed", { key: "access.projection", from: "down", to: "healthy" }),
    [],
    "a check that recovers files nothing",
  );
  assert.deepEqual(
    (await run("backup.failed", { reason: "disk full" })).map((r) => r.title),
    ["The backup is failing", "The backup is failing"],
  );
  assert.deepEqual(
    (await run("incident.opened", { incidentId: "inc_1", kind: "data_leak", ownerId: cara.id })).map((r) => [
      r.person,
      r.kind,
      r.title,
    ]),
    [[cara.id, "incident.owned", "Incident you own: data leak"]],
  );
  assert.deepEqual(
    (
      await run("site.build_failed", { siteId: "sit_1", deploymentId: "dep_1", reason: "npm install failed" }, cara.id)
    ).map((r) => [r.person, r.kind, r.title]),
    [[cara.id, "run.failed", "The site build failed: npm install failed"]],
  );
  assert.deepEqual(
    await run("import.failed", { importId: "imp_1", runId: "run_9", type: "contact", error: "bad file" }, cara.id),
    [],
    "a failed import is told once, by its Run's run.failed",
  );
  assert.deepEqual(
    await run("site.build_failed", { siteId: "sit_1", deploymentId: "dep_1", reason: "x" }, "system"),
    [],
    "a build nobody started tells nobody",
  );
  assert.deepEqual(
    (await run("connection.needs_reconnect", { connectionId: "con_1", connector: "hubspot" })).map((r) => [
      r.kind,
      r.title,
    ]),
    [
      ["sync.attention", "Sync needs attention on the hubspot connection"],
      ["sync.attention", "Sync needs attention on the hubspot connection"],
    ],
  );
  assert.deepEqual(
    (
      await run("sync.op_rejected", {
        cap: "records.update",
        code: "x",
        deviceId: "dev_1",
        opId: "op_1",
        personId: cara.id,
      })
    ).map((r) => [r.person, r.title]),
    [[cara.id, "Sync needs attention on your device"]],
  );
});

test("an agent's notifications_send cannot reach a person with a kind that has no switch; the capability refuses exactly the kinds Settings hides (review W4)", async () => {
  const { NOT_SENT_KINDS } = await import("../projections.ts");
  const app = fs.readFileSync(
    fileURLToPath(new URL("../../../apps/app/src/places/settings/pages-a.tsx", import.meta.url)),
    "utf8",
  );
  const hidden = [...(/UNSENT_KINDS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(app)?.[1] ?? "").matchAll(/"([a-z_.]+)"/g)]
    .map((m) => m[1]!)
    .sort();
  assert.deepEqual(
    [...NOT_SENT_KINDS].sort(),
    hidden,
    "what the send capability refuses is what Settings has no switch for",
  );
  const h = harness();
  for (const kind of hidden) {
    await assert.rejects(
      h.call("notifications.send", { to: alice.id, kind, title: "x" }, as(bot)),
      (e: unknown) => codeOf(e) === "validation.bad_input",
      `${kind} is refused`,
    );
  }
  const ok = await h.call("notifications.send", { to: alice.id, kind: "dm", title: "Hello" }, as(bot));
  assert.ok(ok.notificationId || ok.outcome, "a kind with a switch is still sent");
});
