import test from "node:test";
import assert from "node:assert/strict";
import { AI_ACCOUNTS, pickSpaceFolder } from "./space-folder.ts";

test("a Space-wide key with no folder chosen: the one shared folder, else AI accounts (reused when it exists); never the Space AI key's own folder", () => {
  assert.deepEqual(pickSpaceFolder([]), { name: AI_ACCOUNTS });
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_1", name: "Team keys", canAdd: true }]), { id: "vfd_1", name: "Team keys" });
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_1", name: "Team keys", canAdd: true }, { id: "vfd_k", name: "Space AI key", canAdd: true }]), { id: "vfd_1", name: "Team keys" });
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_1", name: "Team keys", canAdd: false }]), { name: AI_ACCOUNTS }, "a folder the person cannot add to is not theirs to use");
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_c", name: "Company connections", canAdd: true }]), { name: AI_ACCOUNTS }, "the company connection's folder is Vyre's own wiring");
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_1", name: "Team keys", canAdd: true }, { id: "vfd_2", name: "Ops", canAdd: true }]), { name: AI_ACCOUNTS }, "two: neither is the obvious one");
  assert.deepEqual(pickSpaceFolder([{ id: "vfd_1", name: "Team keys", canAdd: true }, { id: "vfd_3", name: "AI accounts", canAdd: true }]), { id: "vfd_3", name: "AI accounts" });
});

import { EVERYONE_GROUP, NOT_SHARED, ensureSpaceFolder } from "./space-folder.ts";

/** A Vault that answers folders.list, folders.create and share, and records every call. */
function vault(folders: Array<{ id: string; name: string; scope: string; yourLevel?: string }>, o: { refuseShare?: boolean; personal?: boolean } = {}) {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    if (cap === "vault.folders.list") return { folders };
    if (cap === "vault.folders.create") { const f = { id: `vfd_new${folders.length}`, name: String(i["name"]), scope: String(i["scope"]) }; folders.push(f); return { folder: f }; }
    if (cap === "vault.share") { if (o.refuseShare) throw new Error("no"); return { granted: true }; }
    if (cap === "spaces.get") return { space: { kind: o.personal ? "personal" : "team" } };
    throw new Error(cap);
  };
  const shares = () => calls.filter((c) => c.cap === "vault.share").map((c) => [(c.input["resource"] as { id: string }).id, (c.input["subject"] as { id: string }).id, c.input["level"]]);
  return { call, calls, shares };
}

test("a Space-wide key's folder is made under its own name and shared with Everyone at Use; one of that name already there is used and shared", async () => {
  const fresh = vault([{ id: "vfd_1", name: "Team keys", scope: "shared", yourLevel: "manage" }]);
  const made = await ensureSpaceFolder(fresh.call, { name: "Connections", idem: "k1" });
  assert.equal(made, "vfd_new1");
  assert.deepEqual(fresh.shares(), [["vfd_new1", EVERYONE_GROUP, "use"]]);
  const old = vault([{ id: "vfd_c", name: "Skills", scope: "shared", yourLevel: "edit" }]);
  assert.equal(await ensureSpaceFolder(old.call, { name: "Skills", idem: "k2" }), "vfd_c");
  assert.deepEqual(old.shares(), [["vfd_c", EVERYONE_GROUP, "use"]], "a Skills folder made before this, shared with nobody, is shared now");
});

test("an AI key reuses the Space's one open folder as it is (its sharing is the person's), else AI accounts made and shared", async () => {
  const one = vault([{ id: "vfd_1", name: "Team keys", scope: "shared", yourLevel: "manage" }]);
  assert.equal(await ensureSpaceFolder(one.call, { name: AI_ACCOUNTS, idem: "k3", reuseOpen: true }), "vfd_1");
  assert.deepEqual(one.shares(), []);
  const none = vault([]);
  assert.equal(await ensureSpaceFolder(none.call, { name: AI_ACCOUNTS, idem: "k4", reuseOpen: true }), "vfd_new0");
  assert.deepEqual(none.shares(), [["vfd_new0", EVERYONE_GROUP, "use"]]);
});

test("a folder that cannot be shared says so in a Team Space; a Personal Space has nobody to share with", async () => {
  await assert.rejects(ensureSpaceFolder(vault([], { refuseShare: true }).call, { name: "Connections", idem: "k5" }), (e) => (e as Error).message === NOT_SHARED);
  assert.equal(await ensureSpaceFolder(vault([], { refuseShare: true, personal: true }).call, { name: "Connections", idem: "k6" }), "vfd_new0");
});
