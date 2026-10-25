// Gateway preAuth (lead review of 471): signed-out callers are told apart by source address, so one script cannot use up the sign-in bucket for everyone, and they are never a person.
import test from "node:test";
import assert from "node:assert/strict";
import { preAuthSession, sourceOf } from "../src/daemon/preauth.ts";

const idOf = (h: Record<string, string>, caller: "anonymous" | "pending" = "anonymous") => preAuthSession("spc_x", caller, h).principal.id;

test("two different addresses get separate ids, the same address the same id, and the id says which kind of caller", () => {
  const a = idOf({ "x-vyre-remote": "203.0.113.9" }), b = idOf({ "x-vyre-remote": "198.51.100.4" });
  assert.notEqual(a, b);
  assert.equal(a, idOf({ "x-vyre-remote": "203.0.113.9" }));
  assert.match(a, /^anon:[0-9a-f]{16}$/);
  assert.match(idOf({ "x-vyre-remote": "203.0.113.9" }, "pending"), /^pending:[0-9a-f]{16}$/);
  assert.notEqual(a.slice(5), idOf({ "x-vyre-remote": "203.0.113.9" }, "pending").slice(8) + "x");
});

test("the principal is a service, never a person, and carries no address", () => {
  const s = preAuthSession("spc_x", "anonymous", { "x-vyre-remote": "203.0.113.9" });
  assert.equal(s.principal.kind, "service");
  assert.ok(!JSON.stringify(s).includes("203.0.113.9"));
});

test("a client cannot pick its own bucket: x-forwarded-for counts only behind a proxy on this machine", () => {
  assert.equal(sourceOf({ "x-vyre-remote": "203.0.113.9", "x-forwarded-for": "198.51.100.4" }), "203.0.113.9", "a remote socket's forwarded header is ignored");
  assert.equal(sourceOf({ "x-vyre-remote": "127.0.0.1", "x-forwarded-for": "198.51.100.4, 10.0.0.1" }), "198.51.100.4", "behind the local proxy the leftmost address is the client");
  assert.equal(sourceOf({ "x-vyre-remote": "::1", "x-forwarded-for": "198.51.100.4" }), "198.51.100.4");
  assert.equal(sourceOf({ "x-vyre-remote": "127.0.0.1" }), "127.0.0.1");
  assert.equal(sourceOf({}), "unknown");
  assert.equal(idOf({ "x-vyre-remote": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }), idOf({ "x-vyre-remote": "203.0.113.9" }));
});
