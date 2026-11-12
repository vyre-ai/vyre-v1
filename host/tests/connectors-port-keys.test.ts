// The connector port remembers which Vault items a call has filled for the whole life of that call: with more than 512 calls between their fill and their request, every request that
// carries a key is still checked against the hosts approved for it (the review found a 512-entry cache that could forget a call and skip the check with the key in its headers).
import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorsHost } from "../src/seams/connectors.ts";
import type { ConnectorCaller } from "../src/seams/connectors.ts";

test("every request after a fill is checked, even with 600 calls in flight", async () => {
  const checked: string[] = [];
  const sent: string[] = [];
  const port = createConnectorsHost({
    publicBase: () => "https://space.example",
    own: () => false,
    network: {
      resolve: async () => ["93.184.216.34"],
      request: async (url) => {
        sent.push(url.hostname);
        return { status: 200, text: "{}" };
      },
    },
    keyHost: async (keys) => {
      checked.push(keys.map((k) => k.itemId).join(","));
      return "refused";
    },
  });
  const N = 600;
  const callers: ConnectorCaller[] = [];
  for (let i = 0; i < N; i++) {
    const trace = { traceId: `t${String(i).padStart(30, "0")}`, spanId: "s".repeat(16) };
    const caller: ConnectorCaller = {
      space: "spc_x",
      principal: { kind: "person", id: "usr_x" },
      trace,
      depth: 0,
      rememberVaultItem: () => undefined,
      call: async (_cap, input) => {
        const ref = (input as { target: { ref: string } }).target.ref;
        port.sink(
          { value: `v${i}`, ref, handle: "#K", field: "api_key", itemId: `vit_${i}` },
          {
            space: "spc_x",
            principal: { kind: "person", id: "usr_x" },
            traceId: trace.traceId,
            parentSpanId: trace.spanId,
            depth: 1,
          },
        );
        return {};
      },
    };
    callers.push(caller);
  }
  // every call fills first, then every call makes its request
  for (const c of callers)
    await port.fill(c, { connector: "app", connectionId: "con_1", slot: "api_key", handle: "#K.api_key" });
  let refused = 0;
  for (const c of callers) {
    try {
      await port.http(c, ["api.app.example"], "https://api.app.example/v1/items", {
        method: "GET",
        headers: { "x-api-key": "v" },
      });
    } catch {
      refused += 1;
    }
  }
  assert.equal(checked.length, N, `every request was checked (${checked.length} of ${N})`);
  assert.equal(refused, N);
  assert.deepEqual(sent, [], "nothing went out");
});
