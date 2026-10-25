// @reads /modules/sync/migrations/0001_pull.sql
// P-SEC_02, the proof a person would see: a booted daemon on the seeded Space, called through the gateway with real tokens (one per device, both Olivia's). The sync module is given the real
// pull, snapshot and push handlers over a real log (the module is still a stub in host/modules.json, so they come in through `extra.handlers`, as daemon.gate does for mail.send).
// Olivia revokes her phone through sync.epoch.bump; then the phone is refused on pull, snapshot (begin and page) and push whatever epoch it presents, and her laptop is not affected.
// A call with no token is refused. Hello is a live-socket frame: the same rule is proven on the hub in revoke.team.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { deviceRevoked } from "../../../sync/src/server/pull/index.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import { createPullHandlers } from "../handlers/pull.ts";
import { createPushHandlers } from "../handlers/push.ts";
import type { PullCtx } from "../handlers/pull.ts";
import { hl, patchOp, pushRig } from "./push.rig.test.ts";
import { NOW } from "../fixtures/world.ts";

const OLIVIA = "usr_olivia";
const PHONE = "tok-phone";
const LAPTOP = "tok-laptop";
const DEVICE_OF: Record<string, string> = { [PHONE]: "dev_phone", [LAPTOP]: "dev_laptop" };
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-revoke-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

type Session = { principal?: { id: string }; device?: string };
const toPull = (ctx: unknown): PullCtx => {
  const c = ctx as { trace: { traceId: string }; principal: { id: string }; device?: string };
  return { trace: c.trace, principal: c.principal.id, deviceId: c.device ?? "", deviceClass: "desktop" };
};

async function boot() {
  // Olivia is the Space's owner in the seeded core; the sync store gets her as an owner too, with the rows she may see
  const rig = pushRig();
  rig.access.putPrincipal({ id: OLIVIA, kind: "person", status: "active", name: OLIVIA });
  rig.access.addPrincipalRole({ holder: OLIVIA, role: "owner" });
  for (const type of ["record", "thread", "space", "file", "number"]) rig.access.putGrant({ id: `gr_olivia_${type}`, subject_kind: "actor", subject_id: OLIVIA, resource_type: type, resource_id: null, level: "manage" });
  const seq = rig.seed("contact", "c1", { name: "Ann", email: "a@example.com", phone: "+1", region: "eu", stage: "lead", owner: OLIVIA });
  const pull = createPullHandlers(rig.s.deps);
  const push = createPushHandlers({ deviceRevoked: (person, device) => deviceRevoked(rig.s.host.tx, person, device), ...rig.deps });
  const purge = createPurgeHandlers(purgeDepsOf(rig.s, { purge: () => 0 }));
  const dir = seededDir();
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "revoke-test", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h): Session | null => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? "";
      const device = DEVICE_OF[t];
      return device === undefined ? null : { space: "spc_core", principal: { kind: "person", id: OLIVIA }, device } as never;
    },
    extra: {
      handlers: {
        "sync.pull": ((ctx: never, input: never) => pull["sync.pull"](toPull(ctx), input)) as never,
        "sync.snapshot.begin": ((ctx: never, input: never) => pull["sync.snapshot.begin"](toPull(ctx), input)) as never,
        "sync.snapshot.page": ((ctx: never, input: never) => pull["sync.snapshot.page"](toPull(ctx), input)) as never,
        "sync.push": ((ctx: never, input: never) => push["sync.push"](toPull(ctx), input)) as never,
        "sync.epoch.bump": ((ctx: never, input: never) => { const c = toPull(ctx); return purge["sync.epoch.bump"]({ trace: c.trace, principal: c.principal }, input); }) as never,
      },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  return { d, rig, seq };
}

const post = (d: Daemon, token: string | null, p: string, body: unknown) =>
  fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (d: Daemon, token: string | null, p: string) => fetch(`${d.url}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const codeOf = async (r: Response): Promise<string> => ((await r.json()) as { error?: { code?: string } }).error?.code ?? "";

test("revoke (booted): after sync.epoch.bump the phone is refused on pull, snapshot and push through the gateway whatever epoch it presents; the laptop is not; no token is refused", async () => {
  const { d, rig, seq } = await boot();
  try {
    // before: both devices pull and the phone can start a snapshot
    for (const t of [PHONE, LAPTOP]) {
      const r = await post(d, t, "/sync/v1/pull", { cursor: 0, epoch: 0 });
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
      assert.equal(((await r.json()) as { data: { changes: unknown[] } }).data.changes.length, 1);
    }
    const begun = await post(d, PHONE, "/sync/v1/snapshot/begin", { deviceClass: "desktop" });
    assert.equal(begun.status, 200, JSON.stringify(await begun.clone().json()));
    const begin = ((await begun.json()) as { data: { asOfSeq: number; plan: { entity: string }[] } }).data;

    // the refusal case first: no token
    assert.equal((await post(d, null, "/sync/v1/pull", { cursor: 0, epoch: 0 })).status, 401, "no token, no pull");

    // Olivia revokes the phone, from her laptop
    const bump = await post(d, LAPTOP, "/v1/sync/epoch/bump", { personId: OLIVIA, reason: "device_revoked", deviceId: "dev_phone" });
    assert.equal(bump.status, 200, JSON.stringify(await bump.clone().json()));

    // the phone: pull answers purge with no rows, at any epoch it claims
    for (const epoch of [0, 1, 2, 99]) {
      const r = await post(d, PHONE, "/sync/v1/pull", { cursor: 0, epoch });
      assert.equal(r.status, 200);
      const body = ((await r.json()) as { data: { reset?: string; changes: unknown[] } }).data;
      assert.deepEqual([body.reset, body.changes.length], ["purge", 0], `pull at epoch ${epoch}`);
    }
    // snapshot: begin and the page of the snapshot it had started
    const b2 = await post(d, PHONE, "/sync/v1/snapshot/begin", { deviceClass: "desktop" });
    assert.equal(await codeOf(b2), "auth.device_revoked");
    const page = await get(d, PHONE, `/sync/v1/snapshot/page?entity=${begin.plan[0]!.entity}&asOf=${begin.asOfSeq}`);
    assert.equal(await codeOf(page), "auth.device_revoked", "a snapshot begun earlier cannot be paged");
    // push: refused and nothing applied
    for (const epoch of [0, 1, 99]) {
      const r = await post(d, PHONE, "/sync/v1/push", { deviceId: "dev_phone", epoch, ops: [patchOp({ id: `op_phone_${epoch}`, fields: { stage: "lost" }, base: { stage: seq }, hlc: hl(NOW - 1000, 0, "dev_phone") })] });
      assert.equal(await codeOf(r), "auth.device_revoked", `push at epoch ${epoch}`);
    }
    assert.equal(rig.value("contact", "c1", "stage"), "lead", "nothing the revoked phone sent was applied");

    // the laptop: untouched on all of them
    const lp = ((await (await post(d, LAPTOP, "/sync/v1/pull", { cursor: 0, epoch: 0 })).json()) as { data: { reset?: string; changes: unknown[] } }).data;
    assert.deepEqual([lp.reset, lp.changes.length], [undefined, 1]);
    const lb = await post(d, LAPTOP, "/sync/v1/snapshot/begin", { deviceClass: "desktop" });
    assert.equal(lb.status, 200);
    const lpush = await post(d, LAPTOP, "/sync/v1/push", { deviceId: "dev_laptop", epoch: 0, ops: [patchOp({ id: "op_laptop_1", fields: { stage: "won" }, base: { stage: seq }, hlc: hl(NOW - 500, 0, "dev_laptop") })] });
    assert.equal(lpush.status, 200, JSON.stringify(await lpush.clone().json()));
    assert.equal(rig.value("contact", "c1", "stage"), "won", "the laptop's push applied");
  } finally { await d.stop(); }
});
