import test from "node:test";
import assert from "node:assert/strict";
import { inSections, originOf } from "./model.ts";
import type { Item } from "./model.ts";

const it = (id: string, scope: "mine" | "shared", yourLevel: "view" | "use" | "edit" | "manage"): Item => ({ id, name: id, kind: "api_key", folderId: "vfd_1", owner: "usr_x", scope, fieldKeys: [], handle: `#${id}`, spaceOnly: false, injectIntoDeployments: false, yourLevel, label: 0, createdAt: 1, updatedAt: 1 }) as unknown as Item;

test("an item is Mine, Shared with me (shared to use or view) or the Space's (shared and changeable)", () => {
  assert.equal(originOf(it("a", "mine", "manage")), "mine");
  assert.equal(originOf(it("b", "shared", "use")), "with-me");
  assert.equal(originOf(it("c", "shared", "view")), "with-me");
  assert.equal(originOf(it("d", "shared", "edit")), "space");
  assert.equal(originOf(it("e", "shared", "manage")), "space");
});

test("the list shows Mine, then Shared with me, then Space, each with its count; an empty section has no header; search results keep the same sections", () => {
  const items = [it("s1", "shared", "edit"), it("w1", "shared", "use"), it("m1", "mine", "manage"), it("m2", "mine", "manage"), it("w2", "shared", "view")];
  assert.deepEqual(inSections(items).map((e) => ("header" in e ? `${e.header}:${e.count}` : e.item.id)), ["mine:2", "m1", "m2", "with-me:2", "w1", "w2", "space:1", "s1"]);
  assert.deepEqual(inSections([it("w1", "shared", "use")]).map((e) => ("header" in e ? e.header : e.item.id)), ["with-me", "w1"]);
  assert.deepEqual(inSections([]), []);
});
