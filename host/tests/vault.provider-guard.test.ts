// A test never reaches a real provider by accident (r40): the key check with no fetch handed in and no accept mode refuses and says why, instead of asking the real provider with a made-up key.
import test from "node:test";
import assert from "node:assert/strict";
import { createProviderProbe } from "../src/seams/vault.ts";

const withEnv = async (env: Record<string, string | undefined>, f: () => Promise<void>): Promise<void> => {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    await f();
  } finally {
    for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};
const ask = { providerKey: "anthropic", connection: "api_key", caller: "usr_x", apiKey: "sk-ant-made-up" };

// The runtime's own fetch goes through undici's global dispatcher: a recorder put there sees every request that would leave this process.
const DISPATCHER = Symbol.for("undici.globalDispatcher.1");
const recordRequests = (): { sent: string[]; restore: () => void } => {
  const g = globalThis as Record<symbol, unknown>,
    was = g[DISPATCHER],
    sent: string[] = [];
  g[DISPATCHER] = {
    dispatch(opts: { origin?: unknown; path?: string }, handler: { onError?: (e: Error) => void }) {
      sent.push(`${String(opts.origin)}${opts.path ?? ""}`);
      handler.onError?.(new Error("recorded, not sent"));
      return true;
    },
    close: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };
  return { sent, restore: () => (was === undefined ? delete g[DISPATCHER] : (g[DISPATCHER] = was)) };
};

test("with no fetch and no accept mode the key check refuses loudly and never reaches the network", async () => {
  await withEnv({ NODE_TEST_CONTEXT: "child-v8", VYRE_TEST_KEY_CHECK: undefined }, async () => {
    const net = recordRequests();
    try {
      // the recorder sees a request the runtime's own fetch makes (so "nothing sent" below means something)
      await fetch("http://127.0.0.1:59999/").catch(() => undefined);
      assert.equal(net.sent.length, 1, "the recorder sees the runtime's own fetch");
      net.sent.length = 0;
      const r = await createProviderProbe()(ask);
      assert.equal(r.ok, false);
      assert.equal(r.refused, true);
      assert.match(r.detail ?? "", /A test reached a real provider/);
      assert.deepEqual(net.sent, [], "nothing was sent to any provider");
    } finally {
      net.restore();
    }
  });
});

test("a stand-in vendor put in globalThis.fetch is asked for real: the guard stops only the runtime's own fetch", async () => {
  await withEnv({ NODE_TEST_CONTEXT: "child-v8", VYRE_TEST_KEY_CHECK: undefined }, async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: "m2" }] }), { status: 200 }))) as never;
    try {
      assert.deepEqual((await createProviderProbe()(ask)).models, ["m2"]);
    } finally {
      globalThis.fetch = real;
    }
  });
});

test("accept mode accepts a fixture key, and a fetch handed in is used", async () => {
  const MARK = Symbol.for("vyre.test-runner");
  const g = globalThis as Record<symbol, unknown>,
    was = g[MARK];
  g[MARK] = true; // accept mode is honoured only inside the test runner (host/src/test-mode.ts)
  try {
    await withEnv({ VYRE_TEST_KEY_CHECK: "accept" }, async () => {
      assert.equal((await createProviderProbe()(ask)).ok, true);
    });
  } finally {
    if (was === undefined) delete g[MARK];
    else g[MARK] = was;
  }
  await withEnv({ NODE_TEST_CONTEXT: "child-v8", VYRE_TEST_KEY_CHECK: undefined }, async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }))) as never;
    assert.deepEqual((await createProviderProbe({ fetch: fetchFn })(ask)).models, ["m1"]);
  });
});
