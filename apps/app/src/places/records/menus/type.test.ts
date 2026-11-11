// The record type menu: its items, who sees Edit Type, and the one call each makes.
import test from "node:test";
import assert from "node:assert/strict";
import { typeMenu } from "./type.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const items = (es: readonly MenuEntry[]): MenuItem[] => es.filter((e): e is MenuItem => !("separator" in e) && !("head" in e));

test("a type has Open, Star, Copy Name and Edit Type for a person who may edit; each reaches its call", () => {
  const did: string[] = [];
  const its = items(typeMenu({ starred: false, canEdit: true }, { open: () => void did.push("open"), star: (on) => void did.push(`star:${on}`), copyName: () => void did.push("copy"), editType: () => void did.push("edit") }));
  assert.deepEqual(its.map((x) => x.label), ["Open", "Star", "Copy Name", "Edit Type…"]);
  for (const x of its) x.onSelect?.();
  assert.deepEqual(did, ["open", "star:true", "copy", "edit"]);
});

test("a starred type says Remove Star; a person who may not edit gets no Edit Type", () => {
  const did: string[] = [];
  const its = items(typeMenu({ starred: true, canEdit: false }, { open: () => undefined, star: (on) => void did.push(`star:${on}`), editType: () => undefined }));
  assert.deepEqual(its.map((x) => x.label), ["Open", "Remove Star"]);
  its[1]!.onSelect?.();
  assert.deepEqual(did, ["star:false"]);
});

test("Import… is in the menu when the type can take rows, after Copy Name, and reaches its call", () => {
  const did: string[] = [];
  const its = items(typeMenu({ starred: false, canEdit: false, canImport: true }, { open: () => undefined, copyName: () => undefined, importRows: () => void did.push("import") }));
  assert.deepEqual(its.map((x) => x.label), ["Open", "Copy Name", "Import…"]);
  its[2]?.onSelect?.();
  assert.deepEqual(did, ["import"]);
  assert.ok(!items(typeMenu({ starred: false, canEdit: false }, { open: () => undefined, importRows: () => undefined })).some((x) => x.label === "Import…"), "not offered when the type cannot take rows");
});
