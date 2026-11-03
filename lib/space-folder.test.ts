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
