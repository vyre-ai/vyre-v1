// Nothing that cannot be done is offered (prototype amendment 3): a row is shown only where it can be done on this device and in this state.
import test from "node:test";
import assert from "node:assert/strict";
import { setupRows } from "./setup-rows.ts";

const keys = (flow: "personal" | "team" | "member", facts: Parameters<typeof setupRows>[3]): string[] =>
  setupRows(flow, {}, "mac", facts).map((r) => r.key);

test("a first-win row waits for an AI account", () => {
  assert.ok(!keys("personal", { ai: false }).includes("win"));
  assert.ok(keys("personal", { ai: true }).includes("win"));
  assert.ok(keys("personal", {}).includes("win"), "unknown facts hide nothing");
});

test("Add Chrome needs a browser that can install it; Pair your phone needs an address a phone can open", () => {
  assert.ok(!keys("personal", { chrome: false }).includes("chrome"));
  assert.ok(keys("personal", { chrome: true }).includes("chrome"));
  assert.ok(!keys("personal", { phone: false }).includes("phone"));
  assert.ok(keys("personal", { phone: true }).includes("phone"));
});

test("a member's mail, calendar and files row needs a company connection", () => {
  assert.ok(!keys("member", { company: false }).includes("mine"));
  assert.ok(keys("member", { company: true }).includes("mine"));
});
