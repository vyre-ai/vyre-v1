// The Share sheet of a record type and of a record (DESIGN-records-sharing): the Files sheet with the Who can see this line, two switches under each person and the export setting under More.
// Rendered with the test renderer against a stand-in Space that answers access.shares_of, so each press goes through the real handler and out as the one capability call it should be.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import type { LiveQuery } from "../../../../../../client/src/index.ts";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { RecordsDataProvider } from "../sidebar/index.ts";
import type { RecordsData } from "../sidebar/index.ts";
import { RecordShareSheet } from "../sharing/index.ts";

const names: Record<string, string> = { usr_ada: "Ada", usr_bea: "Bea", usr_cal: "Cal" };
const grant = (subject: string, level: string, conditions: Record<string, unknown> = {}) => ({ id: `gnt_${subject}`, subject: { kind: "person", id: subject }, resource: { type: "record_type", id: "deal" }, level, conditions, by: "usr_ada", createdAt: 1 });
const typeShares = {
  shares: [{ grant: grant("usr_ada", "manage"), through: "owner" }, { grant: grant("usr_bea", "edit", { export: true }), through: "direct" }, { grant: grant("usr_cal", "view"), through: "direct" }],
  audience: "added", exporters: "chosen", can: { manage: true, share: true, export: true },
};

function rig(out: unknown) {
  const calls: { cap: string; input: unknown }[] = [];
  const state = { status: "ready", data: out } as never;   // one object for good: a store that answers a new one on every read makes React loop
  const live = (): LiveQuery<unknown> => ({ subscribe: () => () => undefined, getSnapshot: () => state });
  const data = { live, call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return {}; }, nameOf: (id: string) => names[id] ?? id, screens: {}, connection: { get: () => "online", subscribe: () => () => undefined }, nav: {} } as unknown as RecordsData;
  return { data, calls };
}
const directory = { people: [{ id: "usr_dee", name: "Dee" }], groups: [], agents: [] };

async function open(out: unknown, target: Parameters<typeof RecordShareSheet>[0]["target"]) {
  const r = rig(out);
  const root = createRoot();
  await act(async () => { root.render(<RecordsDataProvider value={r.data}><RecordShareSheet target={target} directory={directory} onClose={() => undefined} /></RecordsDataProvider>); });
  await flush();
  return { ...r, root, tree: root.container as unknown as Parameters<typeof find>[0] };
}

test("a type: who can see this, the people with their levels, the switches, and the export setting", async () => {
  const restore = installDom();
  try {
    const s = await open(typeShares, { type: "record_type", id: "deal", name: "Deals" });
    const text = textOf(s.tree);
    for (const word of ["Share", "Deals", "Who can see this", "Only people added", "Bea", "Cal", "Can edit", "Can view", "Can export", "Can share with others", "Export: Chosen people"]) assert.ok(text.includes(word), word);
    assert.equal(find(s.tree, "share-audience-pick-added")?.props["aria-selected"], true, "the chosen audience is lit");
    assert.equal(find(s.tree, "share-export-usr_bea")?.props["aria-checked"], true, "Bea can export");
    assert.equal(find(s.tree, "share-export-usr_cal")?.props["aria-checked"], false, "Cal cannot");
  } finally { restore(); }
});

test("a switch sets only itself, the audience is one call, and a level change sends no switch", async () => {
  const restore = installDom();
  try {
    const s = await open(typeShares, { type: "record_type", id: "deal", name: "Deals" });
    await press(find(s.tree, "share-export-usr_cal"));
    await press(find(s.tree, "share-reshare-usr_bea"));
    await press(find(s.tree, "share-audience-pick-me"));
    await flush();
    assert.deepEqual(s.calls.map((c) => [c.cap, c.input]), [
      ["access.share", { resource: { type: "record_type", id: "deal" }, subject: { kind: "person", id: "usr_cal" }, level: "view", export: true }],
      ["access.share", { resource: { type: "record_type", id: "deal" }, subject: { kind: "person", id: "usr_bea" }, level: "edit", reshare: true }],
      ["access.audience_set", { resource: { type: "record_type", id: "deal" }, audience: "me" }],
    ]);
  } finally { restore(); }
});

test("a viewer who may not share sees the sheet as it is and nothing moves", async () => {
  const restore = installDom();
  try {
    const s = await open({ ...typeShares, can: { manage: false, share: false, export: false } }, { type: "record_type", id: "deal", name: "Deals" });
    await press(find(s.tree, "share-export-usr_cal"));
    await press(find(s.tree, "share-audience-pick-me"));
    await flush();
    assert.deepEqual(s.calls, []);
    assert.equal(find(s.tree, "share-export-usr_cal")?.props["aria-disabled"] ?? find(s.tree, "share-export-usr_cal")?.props.disabled, true);
  } finally { restore(); }
});

test("when the type says anyone who can view may export, every switch is on and locked", async () => {
  const restore = installDom();
  try {
    const s = await open({ ...typeShares, exporters: "viewers" }, { type: "record_type", id: "deal", name: "Deals" });
    assert.equal(find(s.tree, "share-export-usr_cal")?.props["aria-checked"], true);
    await press(find(s.tree, "share-export-usr_cal"));
    assert.deepEqual(s.calls, []);
  } finally { restore(); }
});

test("a record follows its type until it is set apart; the way back is the first choice", async () => {
  const restore = installDom();
  try {
    const follows = { shares: [{ grant: grant("usr_ada", "manage"), through: "owner" }, { grant: grant("usr_cal", "view"), through: "folder" }], audience: "space", exporters: "admins", inherits: "deal", can: { manage: true, share: true, export: true } };
    const s = await open(follows, { type: "record", id: "rec_one", name: "Acme renewal", typeName: "Deals" });
    const text = textOf(s.tree);
    assert.ok(text.includes("Follows Deals") && text.includes("Change for this record only") && text.includes("From Deals"), text);
    assert.equal(find(s.tree, "share-audience-pick"), null, "the choice is hidden until it is asked for");
    assert.equal(find(s.tree, "share-more"), null, "export is a setting of the type");
    await press(find(s.tree, "share-override"));
    await flush();
    assert.ok(find(s.tree, "share-audience-pick"));
    assert.ok(textOf(s.tree).includes("Only me"));
    await press(find(s.tree, "share-audience-pick-me"));
    await flush();
    assert.deepEqual(s.calls.map((c) => [c.cap, c.input]), [["access.audience_set", { resource: { type: "record", id: "rec_one" }, audience: "me" }]]);
  } finally { restore(); }
});

test("a sheet that cannot be read says so", async () => {
  const restore = installDom();
  try {
    const root = createRoot();
    const failed = { status: "error", error: { message: "no" } } as never;
    const data = { live: (): LiveQuery<unknown> => ({ subscribe: () => () => undefined, getSnapshot: () => failed }), call: async () => ({}), nameOf: (id: string) => id, screens: {}, nav: {} } as unknown as RecordsData;
    await act(async () => { root.render(<RecordsDataProvider value={data}><RecordShareSheet target={{ type: "record_type", id: "deal", name: "Deals" }} directory={directory} onClose={() => undefined} /></RecordsDataProvider>); });
    await flush();
    assert.ok(textOf(root.container as never).includes("could not be opened"));
  } finally { restore(); }
});
