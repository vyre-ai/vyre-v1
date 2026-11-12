// The relay's hook path on the box: the exact shape and nothing near it, beside the public path and the door.
import test from "node:test";
import assert from "node:assert/strict";
import { hookPath, publicPathOk } from "../host/src/seams/relay.ts";

test("only POST /hooks/automation/<id>/<secret> of the exact shape is a relay hook", () => {
  for (const p of ["/hooks/automation/aut_abc123/abcdefgh", "/hooks/automation/aut_x/Ab_cd-EF012345"]) { assert.equal(hookPath(p), true, p); assert.equal(publicPathOk(p), true, p); }
  for (const p of ["/hooks/automation/aut_abc/short", "/hooks/automation/aut_abc/abcdefgh?x=1", "/hooks/automation/aut_abc/abcdefgh/", "/hooks/automation/aut_abc/abcdefgh/x", "/hooks/stripe", "/hooks/automation/AUT_x/abcdefgh",
    "/hooks/automation/aut_x/abc%2fdefgh", "/hooks/automation/../v1/x/abcdefgh", "/hooks/automation/aut_x/" + "a".repeat(201), "/hooks", "/v1/automations/webhook_url/get"]) {
    assert.equal(hookPath(p), false, p);
    assert.equal(publicPathOk(p), false, p);
  }
});
