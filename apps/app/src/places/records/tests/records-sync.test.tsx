// Records > a record that syncs from an app, on its page: the source chip with Open in the app, a lock beside what the app owns, saving then saved beside an edited field, a retry when it
// could not be sent, and the earlier values of a field with Restore. The sample Space answers the sync capabilities as the server does; a record of a type that does not sync asks nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, PROJECT, SAMPLE_NOW, createSamplePage, northwind } from "../recordpage/sample.ts";
import type { PageSpace } from "../recordpage/sample.ts";
import type { RecordSync } from "../sync/index.ts";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { createSampleRecords, northwind as tableNorthwind } from "../table/sample.ts";

installDom();
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const synced: PageSpace = { ...northwind, types: [{ ...CLIENT, syncedFrom: "crm_ledger" } as typeof CLIENT, PROJECT] };
const STATE: RecordSync = {
  synced: true, state: "synced", app: { key: "crm_ledger", title: "Ledger", domain: "crm-a.test" }, remoteId: "101", openUrl: "https://app.crm-a.test/people/101", lastSyncAt: SAMPLE_NOW - 60_000,
  fields: [
    { key: "email", dir: "both", state: "synced", at: SAMPLE_NOW - 2000, history: 0 },
    { key: "phone", dir: "both", state: "saving", history: 0 },
    { key: "value", dir: "pull", state: "synced", history: 0 },
    { key: "status", dir: "both", state: "failed", error: "The app answered 500.", outboxId: "obx_7", history: 0 },
    { key: "due", dir: "both", state: "synced", history: 2 },
  ],
};

function world(state: RecordSync = STATE) {
  const s = createSamplePage(synced);
  const inner = s.data.call.bind(s.data);
  const sync: { cap: string; input: any }[] = [];
  s.data.call = async (cap, input) => {
    if (cap.startsWith("sync_types.") || cap.startsWith("connectors.")) {
      sync.push({ cap, input: input as any });
      if (cap === "sync_types.record_state") return state;
      if (cap === "sync_types.field_history") return { entries: [{ historyId: "11", value: "ada@old.example", replacedBy: "app", actor: "sync:crm_ledger", at: SAMPLE_NOW - 3_600_000 }] };
      return { ok: true };
    }
    return inner(cap, input);
  };
  s.data.nav.openSync = (t) => void s.opened.push(`sync:${t}`);
  return { s, sync };
}
const open = (w: ReturnType<typeof world>, type = "clients", id = "cl_0") =>
  mount(createRoot, <RecordPageDataProvider value={w.s.data}><RecordPage type={type} recordId={id} start={{ all: true }} /></RecordPageDataProvider>);

test("the source chip shows the app and Open in the app; the app's name opens the Sync page", async () => {
  const opened: string[] = [];
  (globalThis as { open?: unknown }).open = (u: string) => { opened.push(u); };
  const w = world();
  const root = await open(w);
  await settle();
  assert.ok(find(root, "sync-chip"));
  assert.match(textOf(find(root, "sync-chip")), /Ledger/);
  await press(find(root, "sync-chip-open-app"));
  assert.deepEqual(opened, ["https://app.crm-a.test/people/101"]);
  await press(find(root, "sync-chip-open-sync"));
  assert.ok(w.s.opened.includes("sync:clients"));
});

test("each synced field wears its state: a check, a spinner, a lock, a retry, and a badge when it has earlier values", async () => {
  const w = world();
  const root = await open(w);
  await settle();
  assert.ok(find(find(root, "row-email"), "field-mark-saved"));
  assert.ok(find(find(root, "row-phone"), "field-mark-saving"));
  assert.ok(find(find(root, "row-value"), "field-mark-lock"));
  assert.ok(find(find(root, "row-status"), "field-mark-failed"));
  assert.ok(find(find(root, "row-due"), "field-mark-history-badge"));
});

test("a failed field retries the push; an edit nudges a pass; Restore puts an earlier value back", async () => {
  const w = world({ ...STATE, fields: STATE.fields.map((f) => (f.key === "email" ? { ...f, history: 1 } : f)) });
  const root = await open(w);
  await settle();
  await press(find(root, "field-mark-retry"));
  await settle();
  assert.deepEqual(w.sync.filter((c) => c.cap === "connectors.outbox.retry").map((c) => c.input.outboxId), ["obx_7"]);
  assert.ok(w.sync.some((c) => c.cap === "connectors.sync_now"), "a retry starts a pass");
  w.sync.length = 0;
  await press(find(root, "field-mark-earlier"));
  await settle();
  assert.deepEqual(w.sync.filter((c) => c.cap === "sync_types.field_history").map((c) => c.input.field), ["email"]);
});

test("a type that does not sync asks the server nothing and shows no chip or marks", async () => {
  const w = world();
  const root = await open(w, "projects", "pj_0");
  await settle();
  assert.equal(find(root, "sync-chip"), null);
  assert.equal(w.sync.length, 0);
});

test("the sidebar: a synced type wears the app's logo and a sync dot that opens the Sync page; Bring in from your CRM opens the assistant", async () => {
  const sample = createSampleRecords(tableNorthwind);
  const log: string[] = [];
  const data = {
    ...sample.data, canEditSchema: true,
    call: async (cap: string, input: unknown) => {
      if (cap === "sync_types.list") return { syncedTypes: [{ type: "clients", connector: "crm_ledger", state: "syncing", pending: 0, conflicts: 1, schemaChanges: 0, app: { title: "Ledger", domain: "crm-a.test" } }] };
      return sample.data.call(cap, input);
    },
    nav: { ...sample.data.nav, openSync: (t: string) => void log.push(`sync:${t}`), bringInCrm: () => void log.push("bring-in") },
  };
  const root = await mount(createRoot, <RecordsDataProvider value={data}><RecordsStateProvider><RecordsSidebar /></RecordsStateProvider></RecordsDataProvider>);
  await settle();
  assert.ok(find(root, "sync-logo-crm_ledger"), "the type wears the app's logo");
  assert.ok(find(root, "sync-dot-needs"), "a conflict to decide makes the dot ask for a person");
  await press(find(root, "sync-dot"));
  assert.deepEqual(log, ["sync:clients"]);
  assert.match(textOf(root), /Bring in from your CRM/);
  await press(find(find(root, "row-nav:manage:bring"), "row-nav:manage:bring") ?? find(root, "row-nav:manage:bring"));
  assert.ok(log.includes("bring-in"));
});

test("without the right to change record types the sidebar does not offer Bring in from your CRM", async () => {
  const sample = createSampleRecords(tableNorthwind);
  const data = { ...sample.data, nav: { ...sample.data.nav, bringInCrm: () => undefined } };
  const root = await mount(createRoot, <RecordsDataProvider value={data}><RecordsStateProvider><RecordsSidebar /></RecordsStateProvider></RecordsDataProvider>);
  await settle();
  assert.doesNotMatch(textOf(root), /Bring in from your CRM/);
});
