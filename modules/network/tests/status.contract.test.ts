// The generated contract for network, run against the REAL handlers: the same example inputs and outputs the stub answered with
// (generated/modules/network/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping network to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { harness, NOW } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { handlers } from "../handlers/index.ts";
import type { NetworkCtx } from "../handlers/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "network");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "network").map((e) => [e.name, e.payload]));

type Fn = (ctx: NetworkCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: NetworkCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

/** A Space with an own domain, a certificate, hosts, servers, endpoints and a DNS check, so every optional output field is exercised. */
function populated(): Harness {
  const h = harness();
  const q = (sql: string, ...a: unknown[]): void => { h.raw.run(sql, ...a); };
  q("INSERT INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", 1, "space.example.com", "own_domain", "space.example.com", "space.vyre.run", 1, null, NOW);
  q("INSERT INTO network_cert (host, expires_at, reason, reported_at) VALUES (?, ?, ?, ?)", "space.example.com", NOW + 40 * 86_400_000, null, NOW);
  q("INSERT INTO network_host (host, kind) VALUES (?, ?)", "space.example.com", "app");
  q("INSERT INTO network_dns (domain, ok, records_json, checked_at) VALUES (?, ?, ?, ?)", "space.example.com", 1, JSON.stringify([{ type: "A", name: "space.example.com", value: "203.0.113.5" }]), NOW);
  q("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES (?, ?, ?, ?, ?)", "srv_a1b2c3", "Cloud box", "compute", "healthy", NOW);
  q("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES (?, ?, ?, ?, ?)", "srv_main", "Space server", "space", "healthy", NOW);
  q("INSERT INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES (?, ?, ?, ?, ?)", "direct", "https://space.example.com", "healthy", 9, NOW);
  q("INSERT INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES (?, ?, ?, ?, ?)", "relay", "https://space.vyre.run", "healthy", 60, NOW);
  q("INSERT OR REPLACE INTO network_cert (host, expires_at, reason, reported_at) VALUES (?, ?, ?, ?)", "example", NOW + 40 * 86_400_000, null, NOW);
  return h;
}

/** Renewing a certificate or switching to the relay needs a Space that has reported; elsewhere they are typed errors (status.test.ts). */
const spacesFor = (cap: string): Harness[] => (cap === "network.certificate_renew" || cap === "network.relay_set" ? [populated()] : [harness(), populated()]);

test("a real handler exists for exactly the capabilities the registry declares for network", () => {
  assert.equal(caps.length, 12);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      for (const h of spacesFor(cap.name)) {
        const out = await run(cap.name, h.ctx, ex.input);
        assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
        for (const e of h.events) {
          assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
          const schema = eventSchemas.get(e.name);
          assert.ok(schema, `${e.name} has a schema`);
          assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
        }
      }
    }
  });

  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    for (const h of spacesFor(cap.name)) {
      const out = await run(cap.name, h.ctx, input);
      assert.deepEqual(validate(cap.output, out, "", defs), []);
    }
  });

  test(`${name}: emits only events it declares (some are conditional: status.test.ts covers when)`, async () => {
    const h = populated();
    await run(cap.name, h.ctx, sample(cap.input, 0, defs));
    for (const e of h.events) assert.ok(cap.emits.includes(e.name), `${e.name} is declared`);
  });
}

test("status and servers answer a populated Space in the declared shape", async () => {
  const h = populated();
  const st = await run("network.status", h.ctx, {}) as { address: string; certificate: { state: string } };
  assert.deepEqual([st.address, st.certificate.state], ["space.example.com", "healthy"]);
  const sv = await run("network.servers", h.ctx, {}) as { servers: { serverId: string }[] };
  assert.deepEqual(sv.servers.map((s) => s.serverId), ["srv_a1b2c3", "srv_main"]);
});
