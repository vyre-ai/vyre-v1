// A connector definition is checked before it is stored: every problem is listed, a key is refused, and a trigger must name a list it can read.
import test from "node:test";
import assert from "node:assert/strict";
import { actionStepKey, looksLikeSecret, normalizeConnector, pointerGet, splitStepKey } from "../connector-def.ts";

const good = (): Record<string, unknown> => ({
  app: "acme",
  title: "Acme",
  domains: ["api.acme.test"],
  auth: { type: "bearer", field: "token" },
  actions: [
    { key: "list_orders", title: "List orders", method: "GET", path: "/v1/orders", params: [{ name: "after", in: "query", type: "string" }, { name: "limit", in: "query", type: "integer" }] },
    { key: "get_order", title: "Get an order", method: "GET", path: "/v1/orders/{id}", params: [{ name: "id", in: "path", type: "string" }] },
    { key: "create_order", title: "Create an order", method: "POST", path: "/v1/orders", params: [{ name: "email", in: "body", required: true, type: "string" }] },
  ],
  triggers: [
    { key: "new_order", title: "A new order", kind: "poll", action: "list_orders", intervalSec: 120, items: "/data", idField: "id", cursor: { mode: "after_id", param: "after" } },
    { key: "order_paid", title: "An order is paid", kind: "webhook", idField: "id" },
  ],
});

test("a good definition is stored in its normal form with defaults filled", () => {
  const r = normalizeConnector(good());
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.def.auth.header, "Authorization");
  assert.equal(r.def.auth.prefix, "Bearer ");
  assert.equal(r.def.actions[2]!.effect, "outward");
  assert.equal(r.def.actions[0]!.effect, "read");
  const poll = r.def.triggers[0]!;
  assert.equal(poll.kind === "poll" && poll.order, "newest_first");
});

test("every problem is listed in one answer", () => {
  const bad = good();
  bad["app"] = "Acme!";
  (bad["actions"] as Record<string, unknown>[])[1]!["path"] = "/v1/orders/{ident}";
  (bad["actions"] as Record<string, unknown>[])[2]!["method"] = "TRACE";
  const r = normalizeConnector(bad);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.problems.length >= 3, r.problems.join(" | "));
  assert.ok(r.problems.some((p) => p.includes("app must be")));
  assert.ok(r.problems.some((p) => p.includes("{ident}")));
  assert.ok(r.problems.some((p) => p.includes("method must be")));
});

test("a value that looks like a key is refused wherever it sits, a field name is not", () => {
  for (const value of ["sk_live_abcdefghijklmnop", "Bearer abcdefghijklmnopqrstuvwxyz", "ghp_abcdefghijklmnopqrstuvwxyz0123", "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4"]) {
    const d = good();
    d["title"] = `Acme ${value}`;
    assert.equal(normalizeConnector(d).ok, false, value);
    const e = good();
    ((e["actions"] as Record<string, unknown>[])[0]!["params"] as Record<string, unknown>[])[0]!["description"] = value;
    assert.equal(normalizeConnector(e).ok, false, value);
  }
  assert.equal(looksLikeSecret("api_key"), false);
  assert.equal(looksLikeSecret("Bearer "), false);
  assert.equal(normalizeConnector(good()).ok, true);
});

test("hosts must be public names", () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "intranet", "printer.local", "db.internal"]) {
    const d = good();
    d["domains"] = [host];
    assert.equal(normalizeConnector(d).ok, false, host);
  }
});

test("a header the key travels in cannot also be a parameter", () => {
  const d = good();
  (d["actions"] as Record<string, unknown>[])[0]!["params"] = [{ name: "Authorization", in: "header" }];
  const r = normalizeConnector(d);
  assert.equal(r.ok, false);
  const e = good();
  (e["auth"] as Record<string, unknown>) = { type: "api_key", header: "X-Acme-Key" };
  (e["actions"] as Record<string, unknown>[])[0]!["params"] = [{ name: "x-acme-key", in: "header" }];
  assert.equal(normalizeConnector(e).ok, false);
});

test("a read that is not a GET needs markedSafe, a GET cannot be outward", () => {
  const d = good();
  (d["actions"] as Record<string, unknown>[])[2]!["effect"] = "read";
  assert.equal(normalizeConnector(d).ok, false);
  (d["actions"] as Record<string, unknown>[])[2]!["markedSafe"] = true;
  assert.equal(normalizeConnector(d).ok, true);
  const e = good();
  (e["actions"] as Record<string, unknown>[])[0]!["effect"] = "outward";
  assert.equal(normalizeConnector(e).ok, false);
});

test("a polling trigger needs a GET list it can call with nothing, and a cursor the list takes", () => {
  const d = good();
  (d["triggers"] as Record<string, unknown>[])[0]!["action"] = "create_order";
  assert.equal(normalizeConnector(d).ok, false);
  const e = good();
  (e["triggers"] as Record<string, unknown>[])[0]!["action"] = "get_order";
  assert.equal(normalizeConnector(e).ok, false);
  const f = good();
  (f["triggers"] as Record<string, unknown>[])[0]!["cursor"] = { mode: "after_id", param: "since_id" };
  const r = normalizeConnector(f);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.problems.some((p) => p.includes("since_id")));
  const g = good();
  (g["triggers"] as Record<string, unknown>[])[0]!["intervalSec"] = 5;
  assert.equal(normalizeConnector(g).ok, false);
});

test("step keys join the app and the action and split back", () => {
  assert.equal(actionStepKey("acme", "list_orders"), "acme-list_orders");
  assert.deepEqual(splitStepKey("acme-list_orders"), { app: "acme", action: "list_orders" });
  assert.equal(splitStepKey("records.update"), undefined);
  assert.equal(splitStepKey("send_email"), undefined);
});

test("a JSON pointer reads nested values and arrays", () => {
  const v = { data: [{ id: 1 }, { id: 2 }], "a/b": 3 };
  assert.equal(pointerGet(v, "/data/1/id"), 2);
  assert.equal(pointerGet(v, "/a~1b"), 3);
  assert.equal(pointerGet(v, "/nope/x"), undefined);
  assert.equal(pointerGet(v, ""), v);
});
