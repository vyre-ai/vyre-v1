// Tables a computer of a Personal Space keeps to itself (host/src/peers/sync.ts LOCAL). The access store's cursor is a sequence number of this computer's own log: copied to another computer it
// made that one skip its own access events (modules/access/tests/local-cursor.test.ts), so its table never travels; the access tables themselves do.
import test from "node:test";
import assert from "node:assert/strict";
import { denyModules } from "../src/peers/sync.ts";

test("the access cursor's table never travels between computers; the access tables themselves do", () => {
  assert.equal(denyModules("access_local_cursor"), true);
  for (const t of ["access_fields", "access_grants", "access_principals", "access_resources"]) assert.equal(denyModules(t), false, t);
});

