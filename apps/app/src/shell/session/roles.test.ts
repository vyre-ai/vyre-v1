import test from "node:test";
import assert from "node:assert/strict";
import { holdsRole } from "./session.ts";

test("a role is matched by the id the server sends, so an owner or admin really gets the Console and a member does not", () => {
  for (const form of ["rol_owner", "Owner", "owner"]) assert.equal(holdsRole([form], "owner", "admin"), true, form);
  assert.equal(holdsRole(["rol_member", "rol_admin"], "owner", "admin"), true);
  assert.equal(holdsRole(["rol_developer"], "owner", "admin"), false);
  assert.equal(holdsRole(["rol_member"], "owner", "admin"), false);
  assert.equal(holdsRole([], "owner"), false);
});
