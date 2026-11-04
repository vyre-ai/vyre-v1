// The Share adapters: the levels each type offers, the current access list, a change, a removal, and giving no more than you hold.
import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, NotContained, accessAdapter, noteAdapter, offered } from "./adapter.ts";
import type { ShareKind } from "./adapter.ts";
import type { Level } from "../../../../packages/contracts/src/types.ts";

type Calls = Array<{ cap: string; input: Record<string, unknown> }>;
const names: Record<string, string> = { usr_me: "Irfad", usr_omar: "Omar", grp_everyone: "Everyone", grp_ops: "Ops", agt_a: "Scout" };
const nameOf = (id: string): string => names[id] ?? id;

function world(shares: unknown[], mine: Level, extra: Record<string, unknown> = {}) {
  const calls: Calls = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cap, input });
    if (cap === "access.shares_of") return { shares, mine, ...extra };
    return {};
  };
  return { calls, call };
}
const grant = (kind: string, id: string, level: Level, through = "direct", resId = "x_1", conditions = {}) => ({ grant: { subject: { kind, id }, level, conditions, resource: { id: resId } }, through });
const ownerRow = grant("person", "usr_me", "manage", "owner");

const SIMPLE: Array<[Exclude<ShareKind, "note">, string[]]> = [
  ["vault_item", ["Can use without seeing", "Can view", "Can edit"]],
  ["vault_folder", ["Can use without seeing", "Can view", "Can edit"]],
  ["record_type", ["Can view records", "Can edit records", "Can manage the type"]],
  ["record", ["Can view", "Can edit", "Can manage"]],
  ["agent", ["Can chat with", "Can use", "Can edit", "Can manage"]],
  ["file", ["Can view", "Can edit", "Can manage"]],
  ["folder", ["Can view", "Can edit", "Can manage"]],
  ["artifact", ["Can view", "Can edit", "Can manage"]],
  ["project", ["Can view", "Can edit", "Can manage"]],
];

for (const [kind, labels] of SIMPLE) {
  const top: Level = kind === "vault_item" || kind === "vault_folder" ? "manage" : "manage";
  test(`${kind}: offers its own levels, in order`, async () => {
    const w = world([ownerRow], top);
    const a = accessAdapter({ call: w.call, nameOf }, kind, { id: "x_1" });
    await a.list();
    assert.deepEqual(a.levels.map((l) => l.label), labels);
    assert.ok(a.levels.every((l) => l.gets.length > 0), "every level says what the person gets");
  });

  test(`${kind}: lists who has access now, the Space and the folder rows apart`, async () => {
    const w = world([ownerRow, grant("person", "usr_omar", "view"), grant("group", "grp_everyone", "view"), grant("agent", "agt_a", "view", "folder", "fld_9")], "manage");
    const a = accessAdapter({ call: w.call, nameOf }, kind, { id: "x_1" });
    const s = await a.list();
    assert.equal(s.owner?.name, "Irfad");
    assert.equal(s.anyone, "view");
    assert.deepEqual(s.entries.map((e) => [e.name, e.via, e.fromFolderId]), [["Omar", "grant", null], ["Scout", "folder", "fld_9"]]);
    assert.equal(s.canShare, true);
  });

  test(`${kind}: a change and a removal make the one call`, async () => {
    const w = world([ownerRow], "manage");
    const a = accessAdapter({ call: w.call, nameOf }, kind, { id: "x_1" });
    await a.list();
    const lvl = a.levels[0]!.id;
    await a.set({ kind: "person", id: "usr_omar" }, lvl);
    await a.remove({ kind: "person", id: "usr_omar" });
    await a.setAnyone(lvl);
    await a.setAnyone(null);
    const vault = kind === "vault_item" || kind === "vault_folder";
    const [share, unshare] = vault ? ["vault.share", "vault.unshare"] : ["access.share", "access.unshare"];
    assert.deepEqual(w.calls.slice(1).map((c) => c.cap), [share, unshare, share, unshare]);
    assert.deepEqual(w.calls[1]!.input, { resource: { type: a.resource.type, id: "x_1" }, subject: { kind: "person", id: "usr_omar" }, level: lvl });
    assert.deepEqual(w.calls[4]!.input.subject, { kind: "group", id: "grp_everyone" });
  });

  test(`${kind}: nobody gives more than they have`, async () => {
    // an Editor (the top level of the type when it has no Manage, one below it otherwise)
    const mineLevel: Level = a0(kind);
    const w = world([ownerRow], mineLevel);
    const a = accessAdapter({ call: w.call, nameOf }, kind, { id: "x_1" });
    await a.list();
    const all = LEVELS[kind].map((l) => l.id);
    const may = a.levels.map((l) => l.id);
    assert.ok(may.length < all.length || all.every((l) => may.includes(l)), "cut to the caller");
    const above = all.find((l) => !may.includes(l));
    if (above) {
      await assert.rejects(() => a.set({ kind: "person", id: "usr_omar" }, above), NotContained);
      await assert.rejects(() => a.setAnyone(above), NotContained);
      assert.equal(w.calls.filter((c) => c.cap.endsWith("share")).length, 0, "nothing was sent");
    }
    // and a caller who holds nothing known is offered nothing
    assert.deepEqual(offered(kind, null), []);
  });
}

// the level just below the top one each type offers
function a0(kind: ShareKind): Level {
  return kind === "vault_item" || kind === "vault_folder" ? "view" : kind === "agent" ? "use" : "edit";
}

test("a Viewer is offered only View and cannot share", async () => {
  const w = world([ownerRow], "view");
  const a = accessAdapter({ call: w.call, nameOf }, "file", { id: "fil_1" });
  const s = await a.list();
  assert.deepEqual(a.levels.map((l) => l.id), ["view"]);
  assert.equal(s.canShare, false);
});

test("a record type uses the rights the server returns", async () => {
  const w = world([ownerRow], "edit", { can: { manage: false, share: true, export: false } });
  const a = accessAdapter({ call: w.call, nameOf }, "record_type", { id: "contact" });
  assert.equal((await a.list()).canShare, true);
  assert.deepEqual(a.levels.map((l) => l.id), ["view", "edit"]);
});

test("a record keeps the switches on a person's row", async () => {
  const w = world([ownerRow, grant("person", "usr_omar", "edit", "direct", "rec_1", { export: true })], "manage");
  const a = accessAdapter({ call: w.call, nameOf }, "record", { id: "rec_1" });
  assert.deepEqual((await a.list()).entries[0]!.flags, { export: true });
});

test("a level a type does not offer is refused before any call", async () => {
  const w = world([ownerRow], "manage");
  const a = accessAdapter({ call: w.call, nameOf }, "file", { id: "fil_1" });
  await a.list();
  await assert.rejects(() => a.set({ kind: "person", id: "usr_omar" }, "use"));
  assert.equal(w.calls.length, 1);
});

/* ---------- Notes ---------- */

function noteWorld(owner: string, share: { people: Array<{ personId: string; role: "edit" | "view" }>; space: "off" | "view" | "edit" }) {
  const calls: Calls = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cap, input });
    return cap === "notes.get" ? { note: { noteId: "not_1", owner, share } } : {};
  };
  return { calls, call };
}

test("note: the owner sees View and Edit, the list, and shares", async () => {
  const w = noteWorld("usr_me", { people: [{ personId: "usr_omar", role: "view" }], space: "edit" });
  const a = noteAdapter({ call: w.call, nameOf }, "not_1", "usr_me");
  const s = await a.list();
  assert.deepEqual(a.levels.map((l) => l.label), ["Can view", "Can edit"]);
  assert.deepEqual(s.entries.map((e) => [e.name, e.level]), [["Omar", "view"]]);
  assert.equal(s.anyone, "edit");
  await a.set({ kind: "person", id: "usr_omar" }, "edit");
  await a.remove({ kind: "person", id: "usr_omar" });
  await a.setAnyone(null);
  assert.deepEqual(w.calls.slice(1).map((c) => c.input), [
    { noteId: "not_1", people: [{ personId: "usr_omar", role: "edit" }] },
    { noteId: "not_1", people: [{ personId: "usr_omar", role: "remove" }] },
    { noteId: "not_1", space: "off" },
  ]);
});

test("note: only the owner shares; a reader is offered nothing and cannot", async () => {
  const w = noteWorld("usr_omar", { people: [{ personId: "usr_me", role: "edit" }], space: "off" });
  const a = noteAdapter({ call: w.call, nameOf }, "not_1", "usr_me");
  const s = await a.list();
  assert.deepEqual(a.levels, []);
  assert.equal(s.canShare, false);
  await assert.rejects(() => a.set({ kind: "person", id: "usr_x" }, "view"), NotContained);
  await assert.rejects(() => a.remove({ kind: "person", id: "usr_x" }), NotContained);
  await assert.rejects(() => a.setAnyone("edit"), NotContained);
  assert.equal(w.calls.length, 1);
});

test("note: View and Edit only, and not with groups", async () => {
  const w = noteWorld("usr_me", { people: [], space: "off" });
  const a = noteAdapter({ call: w.call, nameOf }, "not_1", "usr_me");
  await a.list();
  await assert.rejects(() => a.set({ kind: "person", id: "usr_omar" }, "manage"));
  await assert.rejects(() => a.set({ kind: "group", id: "grp_ops" }, "view"));
  await assert.rejects(() => a.setAnyone("manage"));
});
