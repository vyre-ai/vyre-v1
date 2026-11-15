import test from "node:test";
import assert from "node:assert/strict";
import { isMine } from "./connection-owner.ts";

test("a connection row says who owns it in owner.kind: a Space connection is not the person's own, a person's is", () => {
  assert.equal(isMine({ owner: { kind: "space", id: "spc_1" } }), false);
  assert.equal(isMine({ owner: { kind: "person", id: "usr_1" } }), true);
});

test("a row with no owner is the person's own, so it is never hidden", () => {
  assert.equal(isMine({}), true);
});
