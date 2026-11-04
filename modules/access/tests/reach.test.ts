// access.reach (owner, 4 Nov): the level the caller holds on each of a list of things, in one call; a thing that does not exist answers the same as one the caller cannot see.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { REACH_MAX } from "../handlers/reach.ts";
import { world } from "../fixtures/askworld.ts";

const FOLDERS = [{ type: "folder", id: "fld_1" }, { type: "folder", id: "fld_2" }, { type: "folder", id: "fld_nope" }, { type: "file", id: "fld_1" }] as never;

const levels = async (who: string): Promise<string[]> => {
  const { h } = world();
  const out = await handlers["access.reach"](h.as(who), { items: FOLDERS });
  return out.items.map((x) => x.level);
};

test("each person gets the level they hold on each thing, and none for what they cannot open", async () => {
  assert.deepEqual(await levels("usr_mgr"), ["manage", "none", "none", "none"], "a Manage holder on one folder, nothing on the other, nothing on a made-up id or the wrong type");
  assert.deepEqual(await levels("usr_maya"), ["view", "none", "none", "none"]);
  assert.deepEqual(await levels("usr_other"), ["none", "none", "none", "none"]);
});

test("a thing that does not exist answers exactly as one the caller cannot see", async () => {
  const { h } = world();
  const out = await handlers["access.reach"](h.as("usr_other"), { items: [{ type: "folder", id: "fld_1" }, { type: "folder", id: "fld_nope" }] } as never);
  assert.deepEqual(out.items.map((x) => ({ level: x.level, title: x.title })), [{ level: "none", title: undefined }, { level: "none", title: undefined }]);
});

test("the title comes only with a level, and the answer keeps the order of the question", async () => {
  const { h } = world();
  const out = await handlers["access.reach"](h.as("usr_maya"), { items: [{ type: "folder", id: "fld_2" }, { type: "folder", id: "fld_1" }] } as never);
  assert.deepEqual(out.items.map((x) => [x.id, x.level, x.title ?? null]), [["fld_2", "none", null], ["fld_1", "view", "Rivera matters"]]);
});

test("a batch is capped, so one call cannot ask about everything", async () => {
  const { h } = world();
  const items = Array.from({ length: REACH_MAX + 50 }, (_, i) => ({ type: "folder", id: `fld_${i}` }));
  const out = await handlers["access.reach"](h.as("usr_maya"), { items } as never);
  assert.equal(out.items.length, REACH_MAX);
});
