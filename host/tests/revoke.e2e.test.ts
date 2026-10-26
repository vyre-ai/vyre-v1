// P-SEC_04: the security proof end to end. A booted daemon, real tokens, the REAL devices module and the REAL sync handlers (pull, snapshot, push, epoch.bump) over a real sync store.
// A person with two devices revokes one through the gateway (devices.revoke). The devices module itself calls sync.epoch.bump; no recording handler stands in. Then the revoked device's
// next pull answers purge with no rows, its snapshot and push are refused, and every call it makes through the gateway gets 401; the other device pulls, snapshots and pushes as before.
// Stand-ins that remain, and why: host/modules.json is read from a temporary code root where devices is live (the flip waits for P-L1_LIVE and the devices lane); the sync module is still a
// stub there (its impl exports 4 of 16 handlers, so a live flip would refuse to boot), so its real handlers are handed to the daemon through extra.handlers, over the module's own openSync
// store (useSync, setPushDeps; sync.epoch.bump and sync.acl.reindex are in impl.handlers). The host layer cannot import a module, so the sync pieces are taken through the loader's importer. The two devices and their sessions are fixture rows (what sign-in will write).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { AccessSnapshot } from "../../kernel/src/authorize/snapshot.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { fileExportsImporter } from "../src/loader.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { issueSessionToken } from "../src/daemon/session.ts";
import type { Handler } from "../src/invoke.ts";

const NOW = 1_760_000_000_000; // the sync store's clock
const PERSON = "usr_noah";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A code root that is this repo with the devices module live: every top-level entry a symlink, host/ rebuilt around an edited modules.json. */
function codeRootWithDevicesLive(): string {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-coderoot-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const dev = list.modules.find((m) => m.id === "devices");
  assert.ok(dev, "host/modules.json lists devices");
  dev.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-session-revoke-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** The sync module's own handlers, taken through the loader the way the daemon takes a module (a host test cannot import one), over its own store: one contact the person may see. */
async function realSync(root: string) {
  const impl = (await fileExportsImporter(root)("sync")) as unknown as {
    openSync(o: { access: () => unknown; clock: () => number }): { host: { append(e: unknown): { seq: number }; tx: { all(sql: string): unknown[] }; store: { read(q: unknown): unknown[] } }; deps: { hlc(): string; db: unknown } };
    useSync(h: unknown): void;
    setPushDeps(d: unknown): void;
    handlers: Record<string, Handler>;
  };
  const access = new AccessSnapshot();
  access.putRole({ id: "member", clearance: 1, perms: ["records.read"], name: "Member" });
  access.putPrincipal({ id: PERSON, kind: "person", status: "active", name: PERSON });
  access.addPrincipalRole({ holder: PERSON, role: "member" });
  for (const type of ["record", "space"]) access.putGrant({ id: `gr_${type}`, subject_kind: "actor", subject_id: PERSON, resource_type: type, resource_id: null, level: "view" });
  const sync = impl.openSync({ access: () => access, clock: () => NOW });
  const trace = "0123456789abcdef0123456789abcdef";
  const seq = sync.host.append({ type: "sync.row", sv: 1, trace_id: trace, actor: "svc_seed", hlc: "000000000001-0000-srv", vis: "space", payload: { entity: "contact", id: "c1", op: "upsert", fields: { name: "Ann", email: "a@example.com" }, at: NOW } }).seq;
  // armed after the daemon boots: booting calls configureSync (sync is live now), which would reset a handle given before it
  const arm = (): void => { impl.useSync(sync); impl.setPushDeps({
    now: () => NOW, hlc: sync.deps.hlc, epochOf: () => 0,
    invoke: async () => ({ kind: "applied", seq }), clocks: () => ({}), appliedSeq: () => undefined, policy: () => ({ kind: "lww" }), restricted: () => false,
    history: () => {}, openConflict: () => "cfl_x", once: (_p: string, _c: string, _k: string, _i: unknown, run: () => unknown) => run(),
  }); };
  return { handlers: impl.handlers, sync, arm };
}

const post = (d: Daemon, p: string, token: string | null, body: unknown) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
const getp = (d: Daemon, p: string, token: string) => fetch(`${d.url}${p}`, { headers: { authorization: `Bearer ${token}` } });
type PullBody = { data: { reset?: string; changes: unknown[]; epoch: number } };

test("revoke e2e: devices.revoke on a booted daemon makes the device's next pull answer purge and its calls 401; the other device is unaffected", async () => {
  const root = codeRootWithDevicesLive();
  const { handlers, sync, arm } = await realSync(root);
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: root,
    platform: fakePlatform({
      os: "linux", hostname: "revoke-e2e", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: { handlers },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  arm();
  try {
    const A = { device: "dev_a1b2c3", session: "ses_a1b2c3" }, B = { device: "dev_d4e5f6", session: "ses_d4e5f6" };
    const now = Date.now();
    for (const [x, name] of [[A, "Device A"], [B, "Device B"]] as const) {
      d.db!.run(`INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, x.device, PERSON, name, now, now);
      d.db!.run(`INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, x.session, PERSON, x.device, now, now);
    }
    const tokA = issueSessionToken(d.db!, A.session), tokB = issueSessionToken(d.db!, B.session);
    const pull = async (tok: string, epoch = 0): Promise<Response> => post(d, "/sync/v1/pull", tok, { cursor: 0, epoch });

    // before: both devices pull the row; no token is refused
    for (const tok of [tokA, tokB]) {
      const r = await pull(tok);
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
      assert.equal(((await r.json()) as PullBody).data.changes.length, 1);
    }
    assert.equal((await post(d, "/sync/v1/pull", null, { cursor: 0, epoch: 0 })).status, 401, "no token, no pull");
    const begun = await post(d, "/sync/v1/snapshot/begin", tokA, { deviceClass: "desktop" });
    assert.equal(begun.status, 200);
    const begin = ((await begun.json()) as { data: { asOfSeq: number; plan: { entity: string }[] } }).data;

    // B revokes A through the gateway: the real devices.revoke handler calls the real sync.epoch.bump
    const revoked = await post(d, "/v1/devices/revoke", tokB, { deviceId: A.device });
    assert.equal(revoked.status, 200, JSON.stringify(await revoked.clone().json()).slice(0, 300));
    const own = sync.host.tx.all("SELECT person, device, epoch FROM sync_device_epoch");
    assert.deepEqual(own, [{ person: PERSON, device: A.device, epoch: 1 }], "the sync store holds A's revoked epoch row, written by devices.revoke through sync.epoch.bump");
    const events = sync.host.store.read({ type: "sync.epoch_bumped" });
    assert.equal(events.length, 1);

    // A: every call through the gateway is 401 (the session is revoked), so the purge answer is what the sync store itself says for A's id
    for (const [p, body] of [["/sync/v1/pull", { cursor: 0, epoch: 0 }], ["/sync/v1/snapshot/begin", { deviceClass: "desktop" }], ["/sync/v1/push", { deviceId: A.device, epoch: 0, ops: [] }], ["/v1/devices/revoke", { deviceId: B.device }]] as const) {
      assert.equal((await post(d, p, tokA, body)).status, 401, `A, ${p}`);
    }
    assert.equal((await getp(d, `/sync/v1/snapshot/page?entity=${begin.plan[0]!.entity}&asOf=${begin.asOfSeq}`, tokA)).status, 401, "A cannot page the snapshot it began");
    // the sync side on its own, at A's identity, whatever epoch A presents: purge and no rows; snapshot and push refused
    const pctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, principal: { id: PERSON }, device: A.device };
    for (const epoch of [0, 1, 99]) {
      const r = (await (handlers["sync.pull"] as unknown as (c: unknown, i: unknown) => Promise<{ reset?: string; changes: unknown[] }>)(pctx, { cursor: 0, epoch }));
      assert.deepEqual([r.reset, r.changes.length], ["purge", 0], `sync answers A's pull at epoch ${epoch} with purge and no rows`);
    }
    await assert.rejects(() => (handlers["sync.snapshot.begin"] as unknown as (c: unknown, i: unknown) => Promise<unknown>)(pctx, { deviceClass: "desktop" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "auth.device_revoked");
    await assert.rejects(() => (handlers["sync.push"] as unknown as (c: unknown, i: unknown) => Promise<unknown>)(pctx, { deviceId: A.device, epoch: 0, ops: [] }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "auth.device_revoked");

    // B is unaffected on all three
    const bp = (await (await pull(tokB)).json()) as PullBody;
    assert.deepEqual([bp.data.reset, bp.data.changes.length], [undefined, 1], "B still pulls its rows");
    assert.equal((await post(d, "/sync/v1/snapshot/begin", tokB, { deviceClass: "desktop" })).status, 200, "B can still start a snapshot");
    const bpush = await post(d, "/sync/v1/push", tokB, { deviceId: B.device, epoch: 0, ops: [] });
    assert.equal(bpush.status, 200, JSON.stringify(await bpush.clone().json()).slice(0, 300));
  } finally { await d.stop(); }
});
