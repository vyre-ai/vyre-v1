// Records > sync, drawn and pressed: the dot, the chip, the field marks and the Sync page, against a fake server that answers the capabilities as the real one does.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { FieldMark, SyncChip, SyncDot } from "./parts.tsx";
import { SyncPage } from "./SyncPage.tsx";
import { historyMenu } from "./history.ts";
import type { TypeStatus } from "./model.ts";

installDom();
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const NOW = 1_800_000_000_000;

const STATUS: TypeStatus = {
  type: "person", app: { key: "crm_ledger", title: "Ledger", domain: "crm-a.test" }, state: "syncing", paused: false, deletes: "off", conflict: "newest", polling: { activeSec: 60, idleSec: 300, dormantSec: 3600 },
  records: 1240, estimate: 4812, filter: "People changed in the last 12 months", canBackfill: true, lastRun: { at: NOW - 180_000, summary: "1,240 created here." },
  pending: 2, failedPushes: 1, conflicts: 0, schemaChanges: 0, failures: [{ at: NOW - 60_000, summary: "sync of person failed: The app answered 503." }], sentToday: 14, nextPollAt: NOW + 240_000, spec: true,
};

function server(over: Partial<TypeStatus> = {}) {
  const calls: { cap: string; input: any }[] = [];
  const status = { ...STATUS, ...over };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as any });
    if (cap === "sync_types.status") return status;
    if (cap === "connectors.outbox.list" && (input as { state: string }).state === "sent") return { items: [{ outboxId: "obx_9", recordId: "rec_3", op: "update", fields: ["email"], state: "sent", attempts: 1, at: NOW - 30_000 }] };
    if (cap === "connectors.outbox.list") return { items: (input as { state: string }).state === "failed" ? [{ outboxId: "obx_1", recordId: "rec_1", op: "update", fields: ["phone"], state: "failed", attempts: 3, error: "The app answered 500.", at: NOW }] : [] };
    return { ok: true };
  };
  return { call, calls };
}
const nav = () => { const log: string[] = []; return { log, nav: { openRecords: (t: string) => void log.push(`records:${t}`), editMapping: (a: { app: string; type: string }) => void log.push(`edit:${a.app}:${a.type}`), closed: () => void log.push("closed") } }; };

test("the dot says what is going on, and the chip opens the sync and the app", async () => {
  const opened: string[] = [];
  (globalThis as { open?: unknown }).open = (u: string) => { opened.push(u); };
  const pressed: string[] = [];
  const root = await mount(createRoot, (
    <>
      <SyncDot row={{ state: "syncing", pending: 0, conflicts: 2, schemaChanges: 0 }} app="Ledger" onPress={() => pressed.push("dot")} />
      <SyncChip app={{ title: "Ledger", domain: "crm-a.test" }} openUrl="https://app.crm-a.test/people/101" onSync={() => pressed.push("sync")} />
    </>
  ));
  assert.ok(find(root, "sync-dot-needs"));
  await press(find(root, "sync-dot"));
  await press(find(root, "sync-chip-open-sync"));
  await press(find(root, "sync-chip-open-app"));
  assert.deepEqual(pressed, ["dot", "sync"]);
  assert.deepEqual(opened, ["https://app.crm-a.test/people/101"]);
  assert.match(textOf(root), /Ledger/);
});

test("a record with no address in the app has a chip without Open", async () => {
  const root = await mount(createRoot, <SyncChip app={{ title: "Ledger" }} />);
  assert.equal(find(root, "sync-chip-open-app"), null);
});

test("a field mark: a lock for what the app owns, a retry for what failed, and earlier values when there are some", async () => {
  const log: string[] = [];
  const lock = await mount(createRoot, <FieldMark kind="lock" tip="Read from Ledger. Change it there." history={0} />);
  assert.ok(find(lock, "field-mark-lock"));
  const failed = await mount(createRoot, <FieldMark kind="failed" tip="Could not save to Ledger. Press to try again." history={0} onRetry={() => log.push("retry")} />);
  await press(find(failed, "field-mark-retry"));
  const earlier = await mount(createRoot, <FieldMark kind="saved" tip="Saved to Ledger 2 s ago" history={2} onHistory={() => log.push("history")} />);
  assert.ok(find(earlier, "field-mark-history-badge"));
  await press(find(earlier, "field-mark-earlier"));
  assert.deepEqual(log, ["retry", "history"]);
  assert.equal((await mount(createRoot, <FieldMark kind="none" tip="" history={0} />)).children?.length ?? 0, 0);
});

test("the Sync page: the app, how far it has got, what failed, what waits, and the filter that holds", async () => {
  const s = server();
  const n = nav();
  const root = await mount(createRoot, <SyncPage type="person" call={s.call} nav={n.nav} now={() => NOW} title="People" />);
  await settle();
  const text = textOf(root);
  assert.match(text, /Synced from Ledger/);
  assert.match(text, /1,240 of 4,812/);
  assert.ok(find(root, "sync-progress"));
  assert.match(text, /Started with: People changed in the last 12 months/);
  assert.match(textOf(find(root, "sync-stat-last")), /3 min/);
  assert.match(textOf(find(root, "sync-stat-next")), /in 4 min/);
  assert.match(textOf(find(root, "sync-stat-failed")), /1/);
  assert.match(textOf(find(root, "sync-deletes")), /Deletes here never reach the app/);
  assert.match(text, /sync of person failed: The app answered 503\./);
  assert.match(text, /The app answered 500\./);
  await press(find(root, "sync-open-records"));
  assert.deepEqual(n.log, ["records:person"]);
});

test("the Sync page buttons call the server: pause, resync, bring in everything, retry, edit mapping", async () => {
  const s = server();
  const n = nav();
  const root = await mount(createRoot, <SyncPage type="person" call={s.call} nav={n.nav} now={() => NOW} />);
  await settle();
  await press(find(root, "sync-pause"));
  await press(find(root, "sync-resync"));
  await press(find(root, "sync-backfill"));
  await press(find(root, "sync-retry-obx_1"));
  await press(find(root, "sync-undo-obx_9"));
  await press(find(root, "sync-edit"));
  await settle();
  const sent = s.calls.filter((c) => c.cap !== "sync_types.status" && c.cap !== "connectors.outbox.list").map((c) => [c.cap, c.input.type ?? c.input.outboxId, c.input.mode ?? ""]);
  assert.deepEqual(sent, [["sync_types.pause", "person", ""], ["connectors.sync_now", "person", "reconcile"], ["sync_specs.backfill", "person", ""], ["connectors.outbox.retry", "obx_1", ""], ["sync_types.undo_push", "obx_9", ""]]);
  assert.ok(s.calls.filter((c) => c.cap !== "sync_types.status" && c.cap !== "connectors.outbox.list").every((c) => typeof c.input.idempotencyKey === "string" || c.cap === "connectors.outbox.retry"));
  assert.deepEqual(n.log, ["edit:Ledger:person"]);
});

test("a paused type offers Resume and holds Resync and the backfill", async () => {
  const s = server({ paused: true, state: "paused" });
  const root = await mount(createRoot, <SyncPage type="person" call={s.call} nav={nav().nav} now={() => NOW} />);
  await settle();
  assert.ok(find(root, "sync-resume"));
  assert.equal(find(root, "sync-pause"), null);
  assert.match(textOf(find(root, "sync-state")), /Paused/);
  assert.match(textOf(find(root, "sync-stat-next")), /paused/);
  await press(find(root, "sync-resync"));
  assert.equal(s.calls.some((c) => c.cap === "connectors.sync_now"), false, "a held button sends nothing");
});

test("Remove asks, and keeping the records or removing them are two different calls", async () => {
  for (const [button, records] of [["sync-remove-keep", "keep"], ["sync-remove-all", "remove"]] as const) {
    const s = server();
    const n = nav();
    const root = await mount(createRoot, <SyncPage type="person" call={s.call} nav={n.nav} now={() => NOW} />);
    await settle();
    await press(find(root, "sync-remove"));
    assert.ok(find(root, "sync-remove-dialog"));
    assert.equal(s.calls.some((c) => c.cap === "sync_specs.remove"), false, "asking sends nothing");
    await press(find(root, button));
    await settle();
    assert.deepEqual(s.calls.filter((c) => c.cap === "sync_specs.remove").map((c) => c.input), [{ type: "person", records }]);
    assert.deepEqual(n.log, ["closed"]);
  }
});

test("a failed call says so in words, in the page", async () => {
  const s = server();
  const failing = async (cap: string, input: unknown): Promise<unknown> => { if (cap === "sync_types.pause") throw { error: { message: "The connection is paused by Dana." } }; return s.call(cap, input); };
  const root = await mount(createRoot, <SyncPage type="person" call={failing} nav={nav().nav} now={() => NOW} />);
  await settle();
  await press(find(root, "sync-pause"));
  await settle();
  assert.match(textOf(find(root, "sync-flash")), /The connection is paused by Dana\./);
});

test("the earlier values of a field are a menu: who replaced each, and Restore for each", () => {
  const restored: string[] = [];
  const entries = [
    { historyId: "1", value: "Ben (typed here)", replacedBy: "app" as const, actor: "sync:crm_ledger", at: NOW - 3_600_000 },
    { historyId: "2", value: "", replacedBy: "you" as const, actor: "source:crm_ledger" },
  ];
  const menu = historyMenu({ title: "Name", app: "Ledger", now: NOW, entries, show: (v) => String(v), onRestore: (e) => restored.push(e.historyId) });
  assert.deepEqual(menu.map((m) => ("head" in m ? m.head : "label" in m ? m.label : "-")), ["Earlier values of name", "Replaced by Ledger 1 h ago", "Restore Ben (typed here)", "Your newer change replaced it", "Restore (empty)"]);
  for (const m of menu) if ("onSelect" in m && m.onSelect) m.onSelect();
  assert.deepEqual(restored, ["1", "2"]);
  const pushed = historyMenu({ title: "Phone", app: "Ledger", now: NOW, entries: [{ historyId: "3", value: "+1 555", replacedBy: "push", by: "usr_dana", actor: "push:usr_dana", at: NOW - 2000 }], show: String, onRestore: () => restored.push("push"), nameOf: () => "Dana" });
  assert.deepEqual(pushed.map((m) => ("head" in m ? m.head : "label" in m ? m.label : "-")), ["Earlier values of phone", "Sent to Ledger by Dana via Vyre 2 s ago", "Sent +1 555"]);
  assert.deepEqual(historyMenu({ title: "Name", app: "Ledger", now: NOW, entries: [], show: String, onRestore: () => undefined }), [{ head: "No earlier values of name" }]);
});

test("a member reads the page without its buttons", async () => {
  const s = server();
  const root = await mount(createRoot, <SyncPage type="person" call={s.call} nav={nav().nav} now={() => NOW} canManage={false} />);
  await settle();
  assert.match(textOf(root), /1,240 of 4,812/);
  assert.equal(find(root, "sync-actions"), null);
  assert.equal(find(root, "sync-pause"), null);
});
