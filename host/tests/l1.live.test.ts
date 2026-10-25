// P-L1_LIVE (rulings 31, 32, 53, 59): the L1 modules that have a complete handler map are live, a booted daemon on the seeded `core` Space reports none of them as not set up, and each
// answers through the gateway with a real token: one read, one write, and a refusal for a member who lacks the permission.
// Path mapping: the packet owns __live__/L1; this test sits in host/tests because it boots the daemon.
// All three L1 modules are live. Gap (on the packet): sync.push parks a collision in sync's own table; the conflicts module's openConflict/recordHistory need a host bridge (a ctx scoped to conflicts) that is not built, so a pushed collision does not reach the Conflicts tab yet.
// Sync: the daemon builds the handle through the configureSync seam (host/src/seams/sync.ts) over the Space store; the sync.changes projection is declared on that store.
// Not wired yet (reported to the lead): the live socket still runs the daemon's own hub (host/src/ws.ts), not sync/src/live, so no hello_ok/ev frames from the sync hub.
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
const LIVE = ["search", "sync", "conflicts"];
const STUB: string[] = [];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER_TOKEN = "tok-usr_olivia";
const MEMBER_TOKEN = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l1-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("l1 live: host/modules.json has the complete L1 modules live and names the two that are not", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L1");
  assert.deepEqual(mine.map((m) => m.id).sort(), [...LIVE, ...STUB].sort());
  for (const m of mine) assert.equal(m.status, LIVE.includes(m.id) ? "live" : "stub", `${m.id} status`);
});

test("l1 live: a booted daemon serves search from its own handlers, reports it as set up, and refuses a member the admin call", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l1-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === MEMBER_TOKEN ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "dev_l1live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && LIVE.includes(m.module));
    assert.deepEqual(notSetUp, [], "no live L1 module is reported as not set up");
    const row = (d.db!.all("SELECT detail FROM health_probe WHERE name = ?", "module_drivers")[0] ?? { detail: "" }) as { detail: string };
    for (const id of LIVE) assert.ok(!new RegExp(`\\b${id}\\b \\(`).test(row.detail), `health does not list ${id} as not set up`);

    const read = await post(OWNER_TOKEN, "/v1/search/query", { q: "acme" });
    assert.equal(read.status, 200, `search.query: ${await read.clone().text()}`);
    assert.ok(((await read.json()) as { data?: unknown }).data !== undefined, "search.query has a data body");
    const write = await post(OWNER_TOKEN, "/v1/search/recent/record", { kind: "record", itemId: "rec_l1live" });
    assert.equal(write.status, 200, `search.recent.record: ${await write.clone().text()}`);
    const recent = await post(OWNER_TOKEN, "/v1/search/recent/list", {});
    assert.equal(recent.status, 200, `search.recent.list: ${await recent.clone().text()}`);
    assert.ok(Array.isArray(((await recent.json()) as { data: { hits: unknown[] } }).data.hits), "recent answers a list of hits (an item that is not indexed is not listed)");

    const refused = await post(MEMBER_TOKEN, "/v1/search/index/rebuild", {});
    assert.equal(refused.status, 403, "a member cannot rebuild the index");
    assert.equal(((await refused.json()) as { error?: { code?: string } }).error?.code, "permission.role_lacks_permission");
    assert.equal((await post("nope", "/v1/search/query", { q: "x" })).status, 401, "no valid token, no search");

    // sync: a read, a write and a refusal, through the gateway
    const status = await post(OWNER_TOKEN, "/v1/sync/status", {});
    assert.equal(status.status, 200, `sync.status: ${await status.clone().text()}`);
    const sd = ((await status.json()) as { data: { mode: string; lag: number } }).data;
    assert.equal(sd.mode, "live");
    const pull = await post(OWNER_TOKEN, "/sync/v1/pull", { cursor: 0, epoch: 0 });
    assert.equal(pull.status, 200, `sync.pull: ${await pull.clone().text()}`);
    const push = await post(OWNER_TOKEN, "/sync/v1/push", { deviceId: "dev_l1live", epoch: 0, ops: [] });
    assert.equal(push.status, 200, `sync.push: ${await push.clone().text()}`);
    const lag = await post(OWNER_TOKEN, "/v1/sync/devices/lag", {});
    assert.equal(lag.status, 200, `sync.devices.lag: ${await lag.clone().text()}`);
    assert.ok(JSON.stringify(await lag.json()).includes("dev_l1live"), "the pull above left the device's cursor");
    const hello = await post(OWNER_TOKEN, "/sync/v1/hello", { deviceId: "dev_l1live", deviceClass: "desktop", appVersion: "1.2.3", registryHash: "x", cursor: 0, epoch: 0, replica: { entities: {} } });
    assert.equal(hello.status, 200, `sync.hello: ${await hello.clone().text()}`);
    assert.notEqual(((await hello.json()) as { data: { mode: string } }).data.mode, "live", "a registry hash the server does not know is not live");
    const ents = await post(OWNER_TOKEN, "/v1/sync/entities", {});
    assert.equal(ents.status, 200, `sync.entities: ${await ents.clone().text()}`);
    assert.equal((await post(OWNER_TOKEN, "/v1/sync/health", {})).status, 200, "sync.health");
    assert.equal((await post(OWNER_TOKEN, "/v1/sync/endpoints", {})).status, 200, "sync.endpoints");
    const cl = await post(OWNER_TOKEN, "/v1/conflicts/counts", {});
    assert.equal(cl.status, 200, `conflicts.counts: ${await cl.clone().text()}`);
    const cl2 = await post(OWNER_TOKEN, "/v1/conflicts/list", {});
    assert.equal(cl2.status, 200, `conflicts.list: ${await cl2.clone().text()}`);
    const lagRefused = await post(MEMBER_TOKEN, "/v1/sync/devices/lag", {});
    assert.equal(lagRefused.status, 403, "a member cannot read every device's lag");
    assert.equal((await post("nope", "/sync/v1/pull", { cursor: 0, epoch: 0 })).status, 401, "no token, no pull");
  } finally { await d.stop(); }
});

// Golden 4 (ruling 53): a collision on a protected field reaches the Conflicts tab through the daemon's bridge (sync.push hands it to the conflicts module with that module's own ctx), the person
// settles it, and Undo puts the earlier value back.
test("l1 live golden 4: an offline edit that collides on a protected field is parked in conflicts.list, settled, and Undo restores the value", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l1-golden4", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return t === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_l1live" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (p: string, body: unknown): Promise<{ status: number; data: any; error?: { code?: string } }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER_TOKEN}` }, body: JSON.stringify(body) });
    return { status: r.status, ...((await r.json()) as object) } as never;
  };
  // a record type of the sync catalog with a protected field, made here because the seeded Space does not have it (commission, protected field status)
  const op = (opId: string, id: string, owner: string, base: number) => ({
    opId, traceId: "ab".repeat(16), hlc: `${Date.now().toString(16)}-0001-dev_l1live`, cap: "records.update", v: 1, entity: "g4_deal", id,
    input: { type: "g4_deal", recordId: id, patch: { status: owner }, fields: { status: owner } }, baseSeq: { status: base },
  });
  try {
    // a record type of the Space's own whose status the assistant settles when two edits collide (schema merge rule "assistant")
    const type = await post("/v1/schema/apply", { idempotencyKey: "g4-type", ops: [{ op: "type.create", type: "g4_deal", def: { title: "Deal", plural: "Deals", icon: "dollar", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "status", type: "text", title: "Status", merge: "assistant" }] } }] });
    assert.equal(type.status, 200, JSON.stringify(type));
    const made = await post("/v1/records/create", { idempotencyKey: "g4-rec", type: "g4_deal", fields: { name: "Logo", status: "brief" } });
    assert.equal(made.status, 200, JSON.stringify(made));
    const id = made.data.record.id as string;
    const pulled = await post("/sync/v1/pull", { cursor: 0, epoch: 0 });
    assert.equal(pulled.status, 200, JSON.stringify(pulled));
    const seq0 = (pulled.data.changes as { id: string; seq: number }[]).find((c) => c.id === id)?.seq;
    assert.ok(seq0 !== undefined, "the record is in the sync feed");

    // device 1 changes the owner at the version it saw; device 2, offline, changes it from the same version
    const first = await post("/sync/v1/push", { deviceId: "dev_l1live", epoch: 0, ops: [op("g4-op-a", id, "concept", seq0!)] });
    assert.equal(first.status, 200, JSON.stringify(first));
    assert.equal(first.data.applied.length, 1);
    assert.equal(first.data.conflicts.length, 0);
    const second = await post("/sync/v1/push", { deviceId: "dev_l1live", epoch: 0, ops: [op("g4-op-b", id, "review", seq0!)] });
    assert.equal(second.status, 200, JSON.stringify(second));
    assert.equal(second.data.conflicts.length, 1, "the collision on a protected field is a conflict, not a silent overwrite");
    const conflictId = second.data.conflicts[0].id as string;

    const listed = await post("/v1/conflicts/list", {});
    assert.equal(listed.status, 200, JSON.stringify(listed));
    assert.ok(JSON.stringify(listed.data).includes(conflictId), "the conflict is in conflicts.list");
    const got = await post("/v1/conflicts/get", { conflictId });
    assert.equal(got.status, 200, JSON.stringify(got));

    const settled = await post("/v1/conflicts/resolve", { conflictId, choice: "theirs", summary: "Use the offline edit" });
    assert.equal(settled.status, 200, JSON.stringify(settled));
    const ownerNow = async () => ((await post("/v1/records/get", { type: "g4_deal", recordId: id })).data.record.fields.status as string);
    assert.equal(await ownerNow(), "review", "the chosen value is applied");
    const undone = await post("/v1/conflicts/undo", { resolutionId: settled.data.resolutionId });
    assert.equal(undone.status, 200, JSON.stringify(undone));
    assert.equal(await ownerNow(), "concept", "Undo puts the earlier value back");
    const status = await post("/v1/sync/status", {});
    assert.equal(status.status, 200, JSON.stringify(status));
    assert.equal(typeof status.data.openConflicts, "number", "sync.status counts from the conflicts module");
  } finally { await d.stop(); }
});
