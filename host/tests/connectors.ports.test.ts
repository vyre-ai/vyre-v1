import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorsHost } from "../src/seams/connectors.ts";
import type { ConnectorCaller, FillExecution } from "../src/seams/connectors.ts";
const binding = { connector: "fixture", connectionId: "con_fixture", slot: "Key", handle: "#Fixture.key" };
const identity = {
  space: "spc_fixture",
  principal: { kind: "agent", id: "agt_fixture" },
  actingFor: "usr_owner",
  trace: { traceId: "1".repeat(32), spanId: "2".repeat(16) },
  depth: 0,
};
const execution: FillExecution = {
  space: identity.space,
  principal: identity.principal,
  actingFor: identity.actingFor,
  traceId: identity.trace.traceId,
  parentSpanId: identity.trace.spanId,
  depth: 1,
};
test("connector Vault fill reference binds caller, delegation, trace, nesting and exact handle; reuse/errors clean the ref", async () => {
  const host = createConnectorsHost({ publicBase: () => "https://space.fixture.test", own: () => false });
  let ref = "";
  const value = `fixture-${crypto.randomUUID()}`;
  const caller: ConnectorCaller = {
    ...identity,
    call: async (_cap, input) => {
      const target = input as { target: { ref: string } };
      ref = target.target.ref;
      const filled = { value, ref, handle: "#Fixture", field: "key", itemId: "vit_fixture" };
      assert.throws(() => host.sink({ ...filled, handle: "#Other" }, execution));
      assert.throws(() => host.sink(filled, { ...execution, actingFor: "usr_other" }));
      assert.throws(() => host.sink(filled, { ...execution, depth: 0 }));
      host.sink(filled, execution);
      assert.throws(() => host.sink(filled, execution));
      return { filled: true };
    },
  };
  assert.equal(await host.fill(caller, binding), value);
  assert.equal(host.accepts(ref), false);
  await assert.rejects(
    host.fill(
      {
        ...caller,
        call: async (_cap, input) => {
          ref = (input as { target: { ref: string } }).target.ref;
          throw new Error("fixture denied");
        },
      },
      binding,
    ),
  );
  assert.equal(host.accepts(ref), false);
  assert.equal(host.publicBase(), "https://space.fixture.test");
});
test("connector request guard rejects undeclared/HTTP/private/DNS rebinding targets and credential redirects before sending", async () => {
  let requests = 0,
    ip = "203.0.113.8",
    redirect = "";
  const host = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => false,
    network: {
      resolve: async () => [ip],
      request: async (url, options) => {
        requests++;
        assert.deepEqual(options.ips, [ip]);
        return redirect ? { status: 302, location: redirect, text: "" } : { status: 200, text: "{}" };
      },
    },
  });
  const caller = { ...identity, call: async () => ({}) };
  for (const url of ["http://api.fixture.test/x", "https://other.test/x", "https://name:password@api.fixture.test/x"])
    await assert.rejects(host.http(caller, ["api.fixture.test"], url));
  assert.equal(requests, 0);
  ip = "127.0.0.1";
  await assert.rejects(host.http(caller, ["api.fixture.test"], "https://api.fixture.test/x"));
  assert.equal(requests, 0);
  ip = "203.0.113.8";
  await host.http(caller, ["api.fixture.test"], "https://api.fixture.test/x");
  assert.equal(requests, 1);
  redirect = "https://other.fixture.test/x";
  await assert.rejects(
    host.http(caller, ["api.fixture.test", "other.fixture.test"], "https://api.fixture.test/x", {
      headers: { Authorization: "fixture-value" },
    }),
  );
  assert.equal(requests, 2, "the credential redirect is not sent");
  redirect = "/again";
  let resolutions = 0;
  const rebound = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => false,
    network: {
      resolve: async () => [++resolutions === 1 ? "203.0.113.8" : "169.254.169.254"],
      request: async () => ({ status: 302, location: "/again", text: "" }),
    },
  });
  await assert.rejects(rebound.http(caller, ["api.fixture.test"], "https://api.fixture.test/x"));
  assert.equal(resolutions, 2);
});

test("connector authorization is checked again after awaited DNS before credentials reach a socket", async () => {
  let sent = false,
    allowed = true;
  const host = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => false,
    network: {
      resolve: async () => {
        allowed = false;
        return ["203.0.113.8"];
      },
      request: async () => {
        sent = true;
        return { status: 200, text: "{}" };
      },
    },
  });
  const caller = {
    ...identity,
    call: async () => ({}),
    assertAuthorized: () => {
      if (!allowed) throw new Error("fixture authorization revoked");
    },
  };
  await assert.rejects(
    host.http(caller, ["api.fixture.test"], "https://api.fixture.test/x", {
      headers: { Authorization: "fixture-value" },
    }),
    /fixture authorization revoked/,
  );
  assert.equal(sent, false);
});

test("a request that carries a credential never reaches a private or loopback address, not even for the Space's owner (own node); one with no credential may", async () => {
  const sent: string[] = [];
  let ip = "10.0.0.5";
  const host = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => true,
    network: {
      resolve: async () => [ip],
      request: async (url) => {
        sent.push(url.hostname);
        return { status: 200, text: "{}" };
      },
    },
  });
  const plain = { ...identity, call: async () => ({}) };
  const carrying = { ...plain, carriesCredential: true } as ConnectorCaller;
  for (const addr of ["10.0.0.5", "127.0.0.1", "192.168.1.9"]) {
    ip = addr;
    await assert.rejects(
      host.http(carrying, ["api.fixture.test"], "https://api.fixture.test/x", { headers: { "X-Api-Key": "k" } }),
      /network address/,
      addr,
    );
  }
  assert.equal(sent.length, 0, "the key reached nobody");
  ip = "10.0.0.5";
  await host.http(plain, ["api.fixture.test"], "https://api.fixture.test/x");
  assert.equal(sent.length, 1, "a request with no credential keeps the owner's own-node allowance");
});

test("an address lookup or a request that never answers fails as a network failure at its deadline instead of holding the call for ever", async () => {
  const caller = { ...identity, call: async () => ({}) };
  const hungRequest = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => false,
    deadlineMs: 30,
    network: { resolve: async () => ["203.0.113.8"], request: () => new Promise(() => undefined) },
  });
  await assert.rejects(
    hungRequest.http(caller, ["api.fixture.test"], "https://api.fixture.test/x"),
    /The connector request failed/,
  );
  const hungLookup = createConnectorsHost({
    publicBase: () => "https://space.fixture.test",
    own: () => false,
    deadlineMs: 30,
    network: { resolve: () => new Promise(() => undefined), request: async () => ({ status: 200, text: "{}" }) },
  });
  await assert.rejects(
    hungLookup.http(caller, ["api.fixture.test"], "https://api.fixture.test/x"),
    /could not be resolved/,
  );
});
