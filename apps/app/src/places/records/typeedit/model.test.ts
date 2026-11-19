// Can go in emails (lane r42-email-in): the field editor switch and what can never be switched on.
import test from "node:test";
import assert from "node:assert/strict";

import { isMergeable, mergeableBlocked, mergeableOps } from "./model.ts";
test("Can go in emails: the op keeps the field's other options, and private, secret, id and computed fields can never be switched on", () => {
  const f = { key: "name", type: "text", title: "Name", options: { codec: "x" } } as never;
  assert.deepEqual(mergeableOps("contact", f, true), [
    { op: "field.update", type: "contact", field: "name", def: { options: { codec: "x", mergeable: true } } },
  ]);
  const on = { ...(f as object), options: { codec: "x", mergeable: true } } as never;
  assert.equal(isMergeable(on), true);
  assert.deepEqual(mergeableOps("contact", on, false), [
    { op: "field.update", type: "contact", field: "name", def: { options: { codec: "x" } } },
  ]);
  assert.equal(mergeableBlocked(f), null);
  for (const type of ["sealed", "files", "signature", "relation", "person", "formula", "rollup", "lookup"])
    assert.ok(mergeableBlocked({ key: "k", type, title: "K" } as never), type);
  assert.ok(mergeableBlocked({ key: "k", type: "text", title: "K", label: "restricted" } as never));
  assert.ok(mergeableBlocked({ key: "k", type: "text", title: "K", label: "confidential" } as never));
  assert.equal(mergeableBlocked({ key: "k", type: "text", title: "K", label: "public" } as never), null);
  assert.ok(mergeableBlocked({ key: "k", type: "text", title: "K", writeOnlyBy: ["x"] } as never));
});
