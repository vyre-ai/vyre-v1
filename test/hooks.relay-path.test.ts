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

test("a relayed visitor is counted by the address the relay saw; a direct caller cannot name itself to dodge its own limit", async () => {
  const { sourceOf } = await import("../host/src/daemon/preauth.ts");
  // the relay's own hop: a loopback connection whose one forwarded entry is the visitor
  assert.equal(sourceOf({ "x-vyre-remote": "127.0.0.1", "x-forwarded-for": "198.51.100.66" }), "198.51.100.66");
  // behind the local proxy, the last entry is the proxy's own; whatever the caller wrote before it is ignored
  assert.equal(sourceOf({ "x-vyre-remote": "127.0.0.1", "x-forwarded-for": "10.9.9.9, 203.0.113.9" }), "203.0.113.9");
  // a direct connection from outside: its own forwarded header is not believed
  assert.equal(sourceOf({ "x-vyre-remote": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }), "203.0.113.9");
});
