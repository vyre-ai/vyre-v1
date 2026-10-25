// @reads /modules/sync/migrations/0001_pull.sql
// Personal Space hosting (ARCH 5.13, spec 2.1). The host device is the Space: the real log, pull and push handlers. The phone reaches it through the relay, keeps its own replica and outbox,
// and while the host is off it reads the replica, queues what the person changes and says "Your computer is off"; when the host is back the queue goes through and the replica converges.
// A capability the Personal matrix refuses (teamOnly in its manifest) fails with permission.needs_team before any work.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { compareHlc, parseHlc } from "../../../lib/hlc.ts";
import type { Hlc } from "../../../lib/hlc.ts";
import { createNodeDriver, openReplica } from "../../../sync/src/replica/index.ts";
import type { ReplicaStore, SqlValue } from "../../../sync/src/replica/index.ts";
import { createOutbox, memoryOutboxStore } from "../../../sync/src/outbox/index.ts";
import type { Outbox } from "../../../sync/src/outbox/index.ts";
import { createPhonePurge, HOST_OFF_CHAT_LINE, HOST_OFF_LINE, NEEDS_TEAM_LINE, deviceView, personalEndpoints, placeAgentTurn, refuseTeamOnly, teamOnlySet } from "../../../sync/src/personal/index.ts";
import type { Change, PushReq } from "../../../sync/src/protocol.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import { createPushHandlers } from "../handlers/push.ts";
import { createPersonalHost } from "../handlers/personal.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, NOW } from "../fixtures/world.ts";
import { TRACE, hl, pushRig, patchOp } from "./push.rig.test.ts";

const codeOf = (e: unknown): string => (e as { error?: { code?: string } } | null)?.error?.code ?? "";
const TEAM_ONLY = "campaigns.launch";

// ---- the matrix

test("a Personal Space refuses every team-only capability with permission.needs_team, and a Team Space allows them", () => {
  const set = teamOnlySet(registry.capabilities);
  assert.ok(set.size > 5, `the manifests mark ${set.size} capabilities team-only`);
  for (const name of [TEAM_ONLY, "computers.chrome.act", "backup.run"]) assert.ok(set.has(name), `${name} is team-only`);
  for (const name of ["sync.pull", "sync.push", "records.get", "chat.send"]) assert.ok(!set.has(name), `${name} works in a Personal Space`);
  for (const cap of set) {
    assert.throws(() => refuseTeamOnly("personal", cap, set, TRACE), (e: unknown) => codeOf(e) === "permission.needs_team", cap);
    assert.doesNotThrow(() => refuseTeamOnly("team", cap, set, TRACE), `${cap} in a Team Space`);
  }
  assert.doesNotThrow(() => refuseTeamOnly("personal", "records.get", set, TRACE));
  let err: unknown;
  try { refuseTeamOnly("personal", TEAM_ONLY, set, TRACE); } catch (e) { err = e; }
  const shaped = (err as { error: { message: string; retryable: boolean; traceId: string; next: Array<{ kind: string }> } }).error;
  assert.ok(shaped.message.startsWith(NEEDS_TEAM_LINE), shaped.message);
  assert.deepEqual([shaped.retryable, shaped.traceId, shaped.next[0]?.kind], [false, TRACE, "open_settings"]);
});

test("the host gates a call before its handler runs, and the gate follows the Space kind", async () => {
  let kind: "personal" | "team" = "personal";
  const ran: string[] = [];
  const host = createPersonalHost({ kind: () => kind, caps: [{ name: TEAM_ONLY, teamOnly: true }, { name: "sync.pull" }] });
  const table = host.guard({
    [TEAM_ONLY]: async () => { ran.push(TEAM_ONLY); return "launched"; },
    "sync.pull": async () => { ran.push("sync.pull"); return "pulled"; },
  });
  const c = { trace: { traceId: TRACE } };
  await assert.rejects(() => table[TEAM_ONLY]!(c as never, {} as never), (e: unknown) => codeOf(e) === "permission.needs_team");
  assert.equal(await table["sync.pull"]!(c as never, {} as never), "pulled");
  assert.deepEqual(ran, ["sync.pull"], "the refused handler never ran");
  kind = "team";
  assert.equal(await table[TEAM_ONLY]!(c as never, {} as never), "launched", "creating a Team Space lifts the refusal");
  assert.deepEqual([...host.teamOnly()], [TEAM_ONLY]);
});

// ---- what a device says, and where a turn runs

test("a device says Your computer is off when the relay answers and the host does not, and Offline when nothing answers", () => {
  assert.deepEqual(deviceView({ status: "live", pending: 0 }), { state: "online", line: "", waiting: "" });
  assert.deepEqual(deviceView({ status: "reconnecting", presence: "absent", pending: 3 }), { state: "host_off", line: HOST_OFF_LINE, waiting: "3 changes waiting" });
  assert.deepEqual(deviceView({ status: "reconnecting", pending: 1 }), { state: "no_network", line: "Offline", waiting: "1 change waiting" });
  assert.equal(deviceView({ status: "connecting", pending: 0 }).state, "connecting");
  assert.equal(deviceView({ status: "read_only", pending: 0 }).state, "read_only");
  assert.equal(deviceView({ status: "stopped", pending: 0 }).state, "stopped");
  assert.equal(HOST_OFF_LINE, "Your computer is off");
});

test("an agent turn in a Personal Space runs on the host only; a phone chat waits while it is off", () => {
  assert.deepEqual(placeAgentTurn("personal", "present"), { where: "host", line: "" });
  assert.deepEqual(placeAgentTurn("personal", "absent"), { where: "waiting", line: HOST_OFF_CHAT_LINE });
  assert.equal(HOST_OFF_CHAT_LINE, "Your computer is off, turn it on to continue");
  assert.deepEqual(placeAgentTurn("team", "absent"), { where: "anywhere", line: "" });
  assert.deepEqual(personalEndpoints({ relay: "wss://relay.example/h1" }), [{ kind: "relay", url: "wss://relay.example/h1" }]);
  assert.deepEqual(personalEndpoints({ direct: "wss://mac.local/live", relay: "wss://relay.example/h1" }).map((e) => e.kind), ["direct", "relay"]);
});

// ---- the phone

function newest(fields: Record<string, { hlc: string }>): string {
  let best: Hlc | null = null;
  let text = "";
  for (const f of Object.values(fields)) {
    const h = parseHlc(f.hlc);
    if (h && (best === null || compareHlc(h, best) > 0)) { best = h; text = f.hlc; }
  }
  return text;
}
const values = (fields: Record<string, { v: unknown }>): Record<string, SqlValue> => Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, c.v as SqlValue]));

const ENT = "contact";
const FIELDS = ["name", "email", "phone", "region", "stage", "owner"] as const;

function scene() {
  const rig = pushRig();
  const pushHandlers = createPushHandlers(rig.deps);
  const host = createPersonalHost({ kind: () => "personal", caps: registry.capabilities });
  const relay = host.relay({ "sync.pull": rig.s.handlers["sync.pull"], "sync.push": pushHandlers["sync.push"] });
  const driver = createNodeDriver();
  const store: ReplicaStore = openReplica({ driver, deviceClass: "phone", registryHash: "h1", personId: ADA });
  let t = NOW;
  const ob: Outbox = createOutbox({ store: memoryOutboxStore(), deviceId: "dev_phone", now: () => t, newTraceId: () => TRACE });
  const phone = {
    store, ob, cursor: 0, driver,
    seen: new Map<string, number>(),
    ctx: { trace: { traceId: TRACE }, principal: ADA, deviceId: "dev_phone", deviceClass: "phone" } as PullCtx,
    advance(ms: number) { t += ms; },
  };
  const apply = (c: Change): void => {
    if (c.op === "delete") return;
    const r = store.write({ entity: c.entity, id: c.id, fields: values(c.fields), hlc: newest(c.fields), actor: ADA, origin: "mirror", seq: c.seq });
    assert.ok(r.applied || r.reason === "older", `${c.op} ${c.id}: ${r.reason}`);
    for (const [f, cell] of Object.entries(c.fields)) phone.seen.set(`${c.entity}|${c.id}|${f}`, (cell as unknown as { seq: number }).seq);
  };
  return {
    rig, host, relay, phone, driver,
    /** The phone pulls through the relay until it is caught up. */
    async pull(): Promise<void> {
      for (let i = 0; i < 50; i++) {
        const res = await relay.handlers["sync.pull"](phone.ctx as never, { cursor: phone.cursor, epoch: 0 } as never) as { changes: Change[]; next: number; more: boolean };
        for (const c of res.changes) apply(c);
        phone.cursor = res.next;
        if (!res.more) return;
      }
      throw new Error("pull did not finish");
    },
    /** A person edits one field on the phone: the replica changes now, the outbox holds the op. */
    edit(id: string, field: string, value: string): void {
      const op = ob.enqueue({ cap: "test.patch", entity: ENT, id, input: { fields: { [field]: value } }, seqOf: { [field]: phone.seen.get(`${ENT}|${id}|${field}`) ?? 0 } });
      const r = store.write({ entity: ENT, id, fields: { [field]: value }, hlc: op.hlc, actor: ADA, origin: "local" });
      assert.ok(r.applied, `local edit ${id}.${field}: ${r.reason}`);
    },
    /** The phone tries to send what is waiting. Returns whether the host took it. */
    async push(): Promise<boolean> {
      const ops = ob.batch();
      if (ops.length === 0) return true;
      try {
        const req: PushReq = { deviceId: "dev_phone", epoch: 0, ops };
        const res = await relay.handlers["sync.push"](phone.ctx as never, JSON.parse(JSON.stringify(req)) as never) as Parameters<Outbox["acknowledge"]>[0];
        ob.observe(res.serverHlc);
        ob.acknowledge(res);
        return true;
      } catch (e) {
        ob.failed(ops.map((o) => o.opId), codeOf(e) || "failed");
        return false;
      }
    },
  };
}

const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, email: `${name.toLowerCase()}@example.com`, phone: "+1555", region: "eu", stage: "lead", owner: ADA, ...extra });
const read = (s: ReturnType<typeof scene>, id: string, f: string): unknown => s.phone.store.read(ENT, id)?.[f];

test("a phone reads, edits and queues while the host is off, then converges when it is back", async () => {
  const s = scene();
  const c1 = s.rig.seed(ENT, "c1", row("Ann"));
  s.rig.seed(ENT, "c2", row("Bea"));

  // 1 on: the phone pulls both rows through the relay
  await s.pull();
  assert.equal(read(s, "c1", "name"), "Ann");
  assert.equal(read(s, "c2", "name"), "Bea");

  // 2 the host goes off: the relay answers unavailable, the phone keeps reading its replica
  s.relay.hostOff();
  await assert.rejects(() => s.pull(), (e: unknown) => codeOf(e) === "internal.unavailable");
  assert.equal(read(s, "c1", "name"), "Ann", "the replica still answers");
  assert.equal(s.host.placeTurn().where, "waiting");
  assert.equal(s.host.placeTurn().line, HOST_OFF_CHAT_LINE);

  // 3 the person edits on the phone: it shows at once and waits in the outbox
  s.edit("c1", "stage", "won");
  assert.equal(read(s, "c1", "stage"), "won", "the replica shows the edit now");
  assert.equal(s.phone.ob.pending(), 1);
  assert.equal(await s.push(), false, "the relay turns the push away");
  assert.equal(s.relay.refused(), 2, "one pull and one push were refused");
  assert.equal(s.phone.ob.pending(), 1, "nothing is lost");
  assert.deepEqual(deviceView({ status: "reconnecting", presence: s.relay.presence(), pending: s.phone.ob.pending() }), { state: "host_off", line: "Your computer is off", waiting: "1 change waiting" });

  // 4 meanwhile the person works at the host: another field of c1 changes and a new row appears
  const host = await s.rig.push(ADA, "dev_host", [patchOp({ id: "op_host1", row: "c1", fields: { name: "Anna" }, base: { name: c1 }, hlc: hl(NOW + 5_000, 0, "dev_host") })]);
  assert.equal(host.applied.length, 1);
  s.rig.seed(ENT, "c3", row("Cy"), NOW + 6_000);

  // 5 the host is back: the queue goes through and the phone pulls what it missed
  s.relay.hostOn();
  s.phone.advance(60_000); // past the retry delay
  assert.equal(await s.push(), true);
  assert.equal(s.phone.ob.pending(), 0);
  await s.pull();
  for (const id of ["c1", "c2", "c3"]) for (const f of FIELDS) assert.equal(read(s, id, f), s.rig.value(ENT, id, f), `${id}.${f} on the phone equals the host`);
  assert.equal(s.rig.value(ENT, "c1", "stage"), "won", "the phone's edit reached the host");
  assert.equal(s.rig.value(ENT, "c1", "name"), "Anna", "the host's edit reached the phone");
  assert.deepEqual(deviceView({ status: "live", presence: s.relay.presence(), pending: 0 }), { state: "online", line: "", waiting: "" });
  assert.equal(s.host.placeTurn().where, "host");
});

test("the same op sent twice after a lost answer is applied once", async () => {
  const s = scene();
  s.rig.seed(ENT, "c1", row("Ann"));
  await s.pull();
  s.edit("c1", "stage", "won");
  const ops = s.phone.ob.batch();
  const req = { deviceId: "dev_phone", epoch: 0, ops } as PushReq;
  const first = await s.relay.handlers["sync.push"](s.phone.ctx as never, JSON.parse(JSON.stringify(req)) as never);
  assert.equal((first as { applied: unknown[] }).applied.length, 1);
  // the answer never reached the phone, so it sends the same op again
  assert.equal(await s.push(), true);
  assert.equal(s.phone.ob.pending(), 0);
  assert.equal(s.rig.applied.size, 1, "one application for one op id");
  assert.equal(s.rig.value(ENT, "c1", "stage"), "won");
});

test("the host revokes the phone: while the host is off nothing changes, and on the phone's next contact the replica is wiped", async () => {
  const s = scene();
  s.rig.seed(ENT, "c1", row("Ann"));
  await s.pull();
  assert.equal(read(s, "c1", "name"), "Ann");
  const admin = createPurgeHandlers(purgeDepsOf(s.rig.s, { purge: () => 0 }));
  const wiped: string[] = [];
  const phonePurge = createPhonePurge({ purge: { driver: s.driver, store: s.phone.store, keychain: { removeAll: () => { wiped.push("keychain"); } }, folder: { wipe: () => { wiped.push("folder"); } } } });

  // the person revokes the phone at the host while the host is off for the phone
  s.relay.hostOff();
  const bump = await admin["sync.epoch.bump"]({ trace: { traceId: TRACE }, principal: ADA }, { personId: ADA, reason: "device_revoked", deviceId: "dev_phone" });
  assert.equal(bump.epoch, 1);
  assert.equal(phonePurge.purged(), false, "nobody can carry the news to the phone");
  assert.equal(read(s, "c1", "name"), "Ann", "the phone still has its replica until it reaches the host");

  // the host is back: the phone's next pull says purge, and only this device is told
  s.relay.hostOn();
  const other = await s.relay.handlers["sync.pull"]({ ...s.phone.ctx, deviceId: "dev_laptop", deviceClass: "desktop" } as never, { cursor: 0, epoch: 0 } as never) as { reset?: string };
  assert.equal(other.reset, undefined, "the person's other devices keep their data");
  const res = await s.relay.handlers["sync.pull"](s.phone.ctx as never, { cursor: s.phone.cursor, epoch: 0 } as never) as { reset?: "purge"; epoch: number };
  assert.equal(res.reset, "purge");
  const report = await phonePurge.onPull(res);
  assert.ok(report, "the purge ran");
  assert.deepEqual(report!.errors, []);
  assert.equal(report!.reason, "revoked");
  assert.equal(report!.personActive, true, "the person is still in their Personal Space");
  assert.ok(report!.tables > 0);
  assert.deepEqual(wiped.sort(), ["folder", "keychain"]);
  assert.equal(phonePurge.purged(), true);
  assert.equal(await phonePurge.onPull(res), null, "the same epoch is handled once");
});
