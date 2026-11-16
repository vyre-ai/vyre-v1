// What a Console page carries from the page that opened it: only the invite sheet's open flag. A page's own state (the role that was open) never overrides a link that names the page afresh (real-app.console 6c: a link to the roles list opened the last role).
import test from "node:test";
import assert from "node:assert/strict";
import { stringState } from "./console.tsx";

test("the invite flag is carried to the page", () => {
  assert.deepEqual(stringState({ invite: "1" }), { invite: "1" });
});

test("a page's own state is not carried over a link", () => {
  assert.deepEqual(stringState({ roleId: "rol_member", filter: "x", open: true }), {});
  assert.deepEqual(stringState({}), {});
});
