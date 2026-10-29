// A connector read is tried only on the document host. The key never enters the plan.
import test from "node:test";
import assert from "node:assert/strict";
import { planSafeTest, runSafeTest } from "../connector-test.ts";
import type { SafeTestInput, SafeTestPlan } from "../connector-test.ts";

const SENTINEL = "sk_live_SECRET";

function input(overrides: Partial<SafeTestInput> = {}): SafeTestInput {
  return {
    method: "GET",
    path: "/v1/customers",
    domains: ["api.stripe.com"],
    vaultItemId: "vit_stripe",
    keyValue: SENTINEL,
    ...overrides,
  };
}

function assertNoSentinel(value: unknown): void {
  assert.equal(JSON.stringify(value).includes(SENTINEL), false);
}

function takePlan(overrides: Partial<SafeTestInput> = {}): SafeTestPlan {
  const out = planSafeTest(input(overrides));
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error("expected a plan");
  assertNoSentinel(out);
  return out.plan;
}

test("GET on the document host returns a plan without the key", () => {
  const out = planSafeTest(input());
  assert.deepEqual(out, {
    ok: true,
    plan: {
      method: "GET",
      url: "https://api.stripe.com/v1/customers",
      vaultItemId: "vit_stripe",
    },
  });
  assertNoSentinel(out);
  assertNoSentinel(out.ok ? out.plan : out);
});

test("POST without markedSafe is refused", () => {
  const out = planSafeTest(input({ method: "POST" }));
  assert.deepEqual(out, { ok: false, reason: "Only a read can be tried." });
  assertNoSentinel(out);
});

test("POST with markedSafe is allowed", () => {
  const out = planSafeTest(input({ method: "POST", markedSafe: true }));
  assert.deepEqual(out, {
    ok: true,
    plan: {
      method: "POST",
      url: "https://api.stripe.com/v1/customers",
      vaultItemId: "vit_stripe",
    },
  });
  assertNoSentinel(out);
});

test("an absolute URL on another host is refused", () => {
  const out = planSafeTest(input({ path: "https://evil.example/v1" }));
  assert.deepEqual(out, { ok: false, reason: "That host is not in the document." });
  assertNoSentinel(out);
});

test("an absolute URL on a document host is allowed", () => {
  const out = planSafeTest(input({ path: "https://api.stripe.com/v1/customers" }));
  assert.deepEqual(out, {
    ok: true,
    plan: {
      method: "GET",
      url: "https://api.stripe.com/v1/customers",
      vaultItemId: "vit_stripe",
    },
  });
  assertNoSentinel(out);
});

test("an http address is refused", () => {
  const out = planSafeTest(input({ path: "http://api.stripe.com/v1" }));
  assert.deepEqual(out, { ok: false, reason: "Only an https address can be tried." });
  assertNoSentinel(out);
});

test("an address with a username and password is refused", () => {
  const out = planSafeTest(input({ path: "https://user:pass@api.stripe.com/v1" }));
  assert.deepEqual(out, { ok: false, reason: "The request address carries a secret." });
  assertNoSentinel(out);
});

test("a 200 read is tested and the send argument has no key", async () => {
  const plan = takePlan();
  let seen = "";
  const out = await runSafeTest(plan, async (sent) => {
    seen = JSON.stringify(sent);
    assert.deepEqual(sent, plan);
    return { status: 200 };
  });
  assert.deepEqual(out, { level: "tested" });
  assert.equal(seen.includes(SENTINEL), false);
  assertNoSentinel(out);
});

test("a 401 or a throw stays a draft", async () => {
  const plan = takePlan();
  let seen = "";
  const denied = await runSafeTest(plan, async (sent) => {
    seen = JSON.stringify(sent);
    return { status: 401 };
  });
  assert.deepEqual(denied, { level: "draft", reason: "The read did not succeed." });
  assert.equal(seen.includes(SENTINEL), false);
  const thrown = await runSafeTest(plan, async () => {
    throw new Error(SENTINEL);
  });
  assert.deepEqual(thrown, { level: "draft", reason: "The read did not succeed." });
  assertNoSentinel(thrown);
});
