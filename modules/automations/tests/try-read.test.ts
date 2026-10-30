// One planned connector read. The key value stays out of the send and the reply.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { setConnectorReadSender, tryConnectorRead } from "../handlers/try-read.ts";
import type { AutoCtx } from "../projections.ts";

const SENTINEL = "sk_live_SECRET";
const ctx = {} as AutoCtx;

const PLAN = {
  method: "GET",
  url: "https://api.stripe.com/v1/customers",
  vaultItemId: "vit_stripe",
};

function readInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: "GET",
    path: "/v1/customers",
    domains: ["api.stripe.com"],
    vaultItemId: "vit_stripe",
    keyValue: SENTINEL,
    key: SENTINEL,
    secret: SENTINEL,
    token: SENTINEL,
    authorization: SENTINEL,
    password: SENTINEL,
    value: SENTINEL,
    ...overrides,
  };
}

function assertNoSentinel(value: unknown): void {
  assert.equal(JSON.stringify(value).includes(SENTINEL), false);
}

afterEach(() => setConnectorReadSender(null));

test("GET sends only the plan and a 204 is tested", async () => {
  let seen: unknown;
  let calls = 0;
  setConnectorReadSender(async (plan) => {
    calls += 1;
    seen = plan;
    return { status: 204, body: SENTINEL };
  });
  const out = await tryConnectorRead(ctx, readInput());
  assert.equal(calls, 1);
  assert.deepEqual(seen, PLAN);
  assert.deepEqual(out, { level: "tested" });
  assertNoSentinel(seen);
  assertNoSentinel(out);
});

test("a 500 stays a draft", async () => {
  let seen: unknown;
  setConnectorReadSender(async (plan) => {
    seen = plan;
    return { status: 500, body: SENTINEL };
  });
  const out = await tryConnectorRead(ctx, readInput());
  assert.deepEqual(seen, PLAN);
  assert.deepEqual(out, { level: "draft", reason: "The read did not succeed." });
  assertNoSentinel(seen);
  assertNoSentinel(out);
});

test("POST without markedSafe does not send", async () => {
  let calls = 0;
  setConnectorReadSender(async () => {
    calls += 1;
    return { status: 200 };
  });
  const out = await tryConnectorRead(ctx, readInput({ method: "POST" }));
  assert.equal(calls, 0);
  assert.deepEqual(out, { level: "draft", reason: "Only a read can be tried." });
  assertNoSentinel(out);
});

test("a host outside domains does not send", async () => {
  let calls = 0;
  setConnectorReadSender(async () => {
    calls += 1;
    return { status: 200 };
  });
  const out = await tryConnectorRead(ctx, readInput({ path: "https://evil.example/v1" }));
  assert.equal(calls, 0);
  assert.deepEqual(out, { level: "draft", reason: "That host is not in the document." });
  assertNoSentinel(out);
});

test("a successful read records tested and does not store the key", async () => {
  const args: unknown[][] = [];
  const ctx = {
    now: () => 5,
    db: { all: () => [], run: (_sql: string, ...rest: unknown[]) => { args.push(rest); return { changes: 1 }; } },
  } as AutoCtx;
  setConnectorReadSender(async () => ({ status: 200 }));
  const out = await tryConnectorRead(ctx, readInput({ actionKey: "stripe-listcustomers" }));
  assert.deepEqual(out, { level: "tested" });
  assert.deepEqual(args, [["stripe-listcustomers", "tested", 5]]);
  assertNoSentinel(args);
  assertNoSentinel(out);
});

test("a valid GET with no sender stays a draft", async () => {
  setConnectorReadSender(null);
  let fetched = 0;
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response(SENTINEL, { status: 200 });
  }) as typeof fetch;
  try {
    const out = await tryConnectorRead(ctx, readInput());
    assert.deepEqual(out, { level: "draft", reason: "The read did not succeed." });
    assert.equal(fetched, 0);
    assertNoSentinel(out);
  } finally {
    globalThis.fetch = prior;
  }
});

test("an agent cannot choose the host and the Vault item of a read; a person can", async () => {
  let calls = 0;
  setConnectorReadSender(async () => { calls += 1; return { status: 204 }; });
  const agentCtx = { principal: { kind: "agent", id: "agt_x" }, actingFor: "usr_a", now: () => 1, db: undefined } as unknown as AutoCtx;
  const personCtx = { principal: { kind: "person", id: "usr_a" }, now: () => 1, db: undefined } as unknown as AutoCtx;
  const refused = await tryConnectorRead(agentCtx, readInput());
  assert.equal(refused.level, "draft");
  assert.match(refused.reason ?? "", /Save the connector first/);
  assert.equal(calls, 0, "nothing was sent for the agent");
  assert.deepEqual(await tryConnectorRead(personCtx, readInput()), { level: "tested" });
  assert.equal(calls, 1);
});
