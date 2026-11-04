// The Share sheet of a Files folder and of an artifact: the one Access sheet over access.shares_of, one capability call per choice, nothing above the caller's own level offered.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { FolderShareSheet } from "./files-share.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const names: Record<string, string> = { usr_ada: "Ada", usr_bea: "Bea", usr_cal: "Cal" };
const grant = (subject: string, level: string, resource = "fld_clients") => ({ id: `gnt_${subject}`, subject: { kind: "person", id: subject }, resource: { type: "folder", id: resource }, level, conditions: {}, by: "usr_ada", createdAt: 0 });

function rig(out: unknown) {
  const calls: { cap: string; input: unknown }[] = [];
  const state = { status: "ready", data: out } as never;
  const q = { subscribe: () => () => undefined, getSnapshot: () => state };
  const people = { status: "ready", data: Object.entries(names).map(([id, name]) => ({ id, name, kind: "person" })) };
  const rt = {
    me: { id: "usr_ada", name: "Ada" }, space: { id: "spc", kind: "team", name: "Northwind" },
    call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return cap === "files.list" ? { folders: [{ folderId: "fld_clients", name: "Clients" }] } : {}; },
    screens: { capQuery: () => q },
    principals: { subscribe: () => () => undefined, getSnapshot: () => people },
  } as unknown as ShellRuntime;
  return { rt, calls };
}
const shares = (mine: string) => ({
  shares: [{ grant: grant("usr_ada", "manage"), through: "owner" }, { grant: grant("usr_bea", "edit"), through: "direct" }, { grant: grant("usr_cal", "view", "fld_parent"), through: "folder" }], mine,
});

async function open(out: unknown, props: Partial<Parameters<typeof FolderShareSheet>[0]> = {}) {
  const r = rig(out);
  const root = createRoot();
  await act(async () => { root.render(<FolderShareSheet rt={r.rt} folderId="fld_clients" onClose={() => undefined} {...props} />); });
  await flush();
  return { ...r, tree: root.container as unknown as Parameters<typeof find>[0] };
}

test("a folder: the Access sheet lists the owner once, Bea on the folder, Cal from above, and General access on top", async () => {
  const restore = installDom();
  try {
    const s = await open(shares("manage"));
    const text = textOf(s.tree);
    for (const word of ["Clients", "General access", "Everyone in Northwind", "People", "Ada", "Owner", "Bea", "Cal", "Can edit", "Can view"]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes("Not in a folder") && !text.includes("never lowered"), text);
  } finally { restore(); }
});

test("a folder: a change and a removal are one call each; a row from above has no remove", async () => {
  const restore = installDom();
  try {
    const s = await open(shares("manage"));
    assert.equal(find(s.tree, "as-acc-remove-usr_cal"), null);
    await press(find(s.tree, "as-acc-level-usr_bea"));
    await press(find(s.tree, "menu-item-Can manage"));
    await press(find(s.tree, "as-acc-remove-usr_bea"));
    await flush();
    const calls = s.calls.filter((c) => c.cap === "access.share" || c.cap === "access.unshare");
    assert.deepEqual(calls.map((c) => c.cap), ["access.share", "access.unshare"]);
    assert.deepEqual(calls[0]!.input, { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_bea" }, level: "manage" });
    assert.deepEqual(calls[1]!.input, { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_bea" } });
  } finally { restore(); }
});

test("a folder: someone who holds Edit is not offered Can manage", async () => {
  const restore = installDom();
  try {
    const s = await open(shares("edit"));
    await press(find(s.tree, "as-acc-level-usr_bea"));
    assert.ok(find(s.tree, "menu-item-Can view"));
    assert.ok(find(s.tree, "menu-item-Can manage") === null, "a person gives no more than they have");
  } finally { restore(); }
});

test("an artifact is shared on its site resource, as an artifact", async () => {
  const restore = installDom();
  try {
    const s = await open(shares("manage"), { folderId: "sit_1", resource: { type: "site", id: "sit_1", name: "Pitch" } });
    assert.ok(textOf(s.tree).includes("Artifact"), textOf(s.tree));
    assert.ok(textOf(s.tree).includes("Pitch"));
    await press(find(s.tree, "as-acc-level-usr_bea"));
    await press(find(s.tree, "menu-item-Can view"));
    await flush();
    assert.deepEqual(s.calls.find((c) => c.cap === "access.share")?.input, { resource: { type: "site", id: "sit_1" }, subject: { kind: "person", id: "usr_bea" }, level: "view" });
  } finally { restore(); }
});

test("a folder: Notify people goes with the share as `notify`, with the message, and Copy link is there", async () => {
  const restore = installDom();
  try {
    const s = await open({ shares: [{ grant: grant("usr_ada", "manage"), through: "owner" }], mine: "manage" });
    await typeInto(find(s.tree, "as-search"), "cal");
    await press(find(s.tree, "as-row-person:usr_cal"));
    await typeInto(find(s.tree, "as-message"), "For the Q4 close");
    await press(find(s.tree, "as-add"));
    await flush();
    const call = s.calls.find((c) => c.cap === "access.share");
    assert.deepEqual(call?.input, { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_cal" }, level: "view", notify: { message: "For the Q4 close" } });
  } finally { restore(); }
  const restore2 = installDom();
  try {
    const s = await open(shares("manage"));
    assert.ok(find(s.tree, "as-copy-link") !== null, "Copy link at the foot");
    assert.ok(find(s.tree, "as-acc-level-usr_bea") !== null);
  } finally { restore2(); }
});
