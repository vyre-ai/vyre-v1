// updates.apply and updates.rollback (P-L7b_06; spec 3.10, b13): a failed update puts the old version back, and a roll back restores the previous version. Final run.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { NOW, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureUpdates, handlers } from "../handlers/index.ts";
import type { UpdateCtx } from "../handlers/channels.ts";

type Fn = (ctx: UpdateCtx, input: never) => Promise<unknown>;
const call = (name: string, ctx: UpdateCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};
const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};

async function ready(): Promise<World> {
  const w = await world({ version: "1.2.0" });
  configureUpdates(w.drivers);
  await w.publish({ version: "1.3.0", notes: "Faster sync." });
  w.events.length = 0;
  return w;
}

afterEach(() => configureUpdates(null));

test("apply installs the newest signed release and records it", async () => {
  const w = await ready();
  w.setNow(NOW);
  const out = await call("updates.apply", w.ctx, {}) as { runId: string };
  assert.equal(out.runId, "run_testrun1");
  assert.equal(w.installer.version, "1.3.0");
  assert.deepEqual(w.installer.log, ["install 1.3.0"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [
    ["update.started", { from: "1.2.0", to: "1.3.0" }],
    ["update.completed", { from: "1.2.0", to: "1.3.0" }],
  ]);
  const row = w.raw.rows("updates_history")[0]!;
  assert.deepEqual([row["id"], row["from_version"], row["to_version"], row["result"], row["reason"]], ["run_testrun1", "1.2.0", "1.3.0", "ok", null]);
  assert.deepEqual(await call("updates.status", w.ctx, {}), { current: "1.3.0", channel: "stable", lastResult: "ok" });
});

test("apply with a version names the newest release or nothing", async () => {
  const w = await ready();
  assert.equal((await failed(call("updates.apply", w.ctx, { to: "1.2.5" }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("updates.apply", w.ctx, { to: "garbage" }))).error.code, "validation.bad_input");
  assert.deepEqual(w.installer.log, []);
  await call("updates.apply", w.ctx, { to: "1.3.0" });
  assert.equal(w.installer.version, "1.3.0");
});

test("apply on the newest version is refused before anything happens", async () => {
  const w = await ready();
  w.installer.version = "1.3.0";
  const err = await failed(call("updates.apply", w.ctx, {}));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /already on 1\.3\.0/);
  assert.deepEqual(w.backups.calls, []);
});

test("a release older than the running version is never installed (the floor only goes up)", async () => {
  const w = await ready();
  await w.publish({ version: "1.0.0" });
  const err = await failed(call("updates.apply", w.ctx, {}));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.deepEqual(w.installer.log, []);
});

test("a new version that is not healthy is replaced by the old one and the update is recorded as failed", async () => {
  const w = await ready();
  w.installer.health = [false, true];
  const out = await call("updates.apply", w.ctx, {}) as { runId: string };
  assert.equal(out.runId, "run_testrun1");
  assert.equal(w.installer.version, "1.2.0", "the server is back on the version it started with");
  assert.deepEqual(w.installer.log, ["install 1.3.0", "switch 1.2.0"]);
  assert.deepEqual(w.events.map((e) => e.name), ["update.started", "update.failed"]);
  assert.deepEqual(w.events[1]!.payload, { to: "1.3.0", reason: "the new version did not pass its health check" });
  const row = w.raw.rows("updates_history")[0]!;
  assert.deepEqual([row["result"], row["reason"], row["backup_id"]], ["failed", "the new version did not pass its health check", "bkp_first1"]);
  assert.equal((await call("updates.status", w.ctx, {}) as { lastResult: string }).lastResult, "failed");
});

test("an install that throws is rolled back the same way", async () => {
  const w = await ready();
  w.installer.installFails = "the image pull failed";
  await call("updates.apply", w.ctx, {});
  assert.deepEqual(w.installer.log, ["install 1.3.0", "switch 1.2.0"]);
  assert.equal(w.installer.version, "1.2.0");
  assert.deepEqual(w.events[1]!.payload, { to: "1.3.0", reason: "the image pull failed" });
});

test("when the old version cannot be put back the reason says so", async () => {
  const w = await ready();
  w.installer.health = [false, false];
  await call("updates.apply", w.ctx, {});
  assert.match(String((w.events[1]!.payload as { reason: string }).reason), /did not pass its health check; the previous version did not come back healthy either/);
  const w2 = await ready();
  w2.installer.installFails = "disk full";
  w2.installer.switchFails = true;
  await call("updates.apply", w2.ctx, {});
  assert.match(String((w2.events[1]!.payload as { reason: string }).reason), /disk full; putting 1\.2\.0 back failed: the switch failed/);
});

test("roll back restores the previous version", async () => {
  const w = await ready();
  await call("updates.apply", w.ctx, {});
  assert.equal(w.installer.version, "1.3.0");
  w.events.length = 0;
  w.installer.log.length = 0;
  w.setNow(NOW + 90_000);
  const out = await call("updates.rollback", w.ctx, { to: "1.2.0" }) as { runId: string };
  assert.equal(out.runId, "run_testrun2");
  assert.equal(w.installer.version, "1.2.0");
  assert.deepEqual(w.installer.log, ["switch 1.2.0"]);
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["update.rolled_back", { from: "1.3.0", to: "1.2.0" }]]);
  const rows = w.raw.rows("updates_history").sort((a, b) => Number(b["at"]) - Number(a["at"]));
  assert.deepEqual([rows[0]!["result"], rows[0]!["from_version"], rows[0]!["to_version"]], ["rolled_back", "1.3.0", "1.2.0"]);
  assert.deepEqual(await call("updates.status", w.ctx, {}), { current: "1.2.0", channel: "stable", lastResult: "rolled_back" });
});

test("roll back goes only to a version the server still keeps", async () => {
  const w = await ready();
  const err = await failed(call("updates.rollback", w.ctx, { to: "0.9.0" }));
  assert.equal(err.error.code, "validation.not_found");
  assert.match(err.error.message, /1\.1\.0, 1\.0\.0/);
  assert.equal((await failed(call("updates.rollback", w.ctx, { to: "1.2.0" }))).error.code, "validation.precondition_failed");
  assert.equal((await failed(call("updates.rollback", w.ctx, { to: "latest" }))).error.code, "validation.bad_input");
  assert.deepEqual(w.installer.log, []);
  assert.deepEqual(w.events, []);
});

test("a roll back that does not come up healthy puts the server back and reports it", async () => {
  const w = await ready();
  w.installer.health = [false];
  const err = await failed(call("updates.rollback", w.ctx, { to: "1.1.0" }));
  assert.equal(err.error.code, "internal.unexpected");
  assert.match(err.error.message, /did not pass its health check after the roll back/);
  assert.deepEqual(w.installer.log, ["switch 1.1.0", "switch 1.2.0"]);
  assert.equal(w.installer.version, "1.2.0");
  assert.deepEqual(w.raw.rows("updates_history"), []);
});

test("a switch that throws is reported with the state it may have left", async () => {
  const w = await ready();
  w.installer.switchFails = true;
  const err = await failed(call("updates.rollback", w.ctx, { to: "1.1.0" }));
  assert.equal(err.error.code, "internal.unexpected");
  assert.match(err.error.message, /roll back did not finish/);
});

test('apply forwards the verified selected channel to the installer',async()=>{
 const w=await ready();await w.publish({channel:'beta',version:'1.3.0'});await call('updates.channel_set',w.ctx,{channel:'beta'});
 let selected:string|undefined;const install=w.installer.install.bind(w.installer);w.installer.install=async(release,channel)=>{selected=channel;await install(release,channel);};
 await call('updates.apply',w.ctx,{to:'1.3.0'});assert.equal(selected,'beta');
});

test('a competing apply cannot roll back the update already in progress',async()=>{
 const w=await ready();w.backups.runs.push({backupId:'bkp_second'});w.backups.listed.push('bkp_second');const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
 const firstFeed=deferred(),secondFeed=deferred(),allowFirst=deferred(),allowSecond=deferred(),installEntered=deferred(),finishInstall=deferred();let reads=0,installs=0;
 const fetch=w.feed.fetch.bind(w.feed);w.feed.fetch=async channel=>{reads++;if(reads===1){firstFeed.resolve();await allowFirst.promise;}else if(reads===2){secondFeed.resolve();await allowSecond.promise;}return fetch(channel);};
 w.installer.install=async release=>{installs++;if(installs!==1)throw new Error('fixture another update already running');w.installer.version=release.version;w.installer.log.push(`install ${release.version}`);installEntered.resolve();await finishInstall.promise;};
 const first=call('updates.apply',w.ctx,{to:'1.3.0'});let second:Promise<{ok:boolean;error?:unknown}>|undefined;
 try{
  await firstFeed.promise;second=call('updates.apply',w.ctx,{to:'1.3.0'}).then(()=>({ok:true}),error=>({ok:false,error}));await Promise.race([secondFeed.promise,second]);
  allowFirst.resolve();await installEntered.promise;allowSecond.resolve();const outcome=await second;
  assert.deepEqual(w.installer.log,['install 1.3.0'],'the contender must not roll back the in-progress install');assert.equal(outcome.ok,false,'the second operation is refused, not installed or rolled back');assert.ok(outcome.error instanceof VyreErr);assert.equal(outcome.error.error.code,'validation.precondition_failed');
  const rollback=await failed(call('updates.rollback',w.ctx,{to:'1.1.0'}));assert.equal(rollback.error.code,'validation.precondition_failed');assert.deepEqual(w.installer.log,['install 1.3.0']);
  finishInstall.resolve();await first;assert.equal(w.installer.version,'1.3.0');
 }finally{allowFirst.resolve();allowSecond.resolve();finishInstall.resolve();await first.catch(()=>undefined);await second;}
});

test('an externally busy installer never triggers rollback and releases the Space operation guard',async()=>{
 const w=await ready(),install=w.installer.install.bind(w.installer);
 w.installer.install=async()=>{w.installer.version='1.3.0';throw Object.assign(new Error('fixture external updater owns the operation'),{code:'update.operation_busy'});};
 const error=await failed(call('updates.apply',w.ctx,{to:'1.3.0'}));assert.equal(error.error.code,'validation.precondition_failed');assert.deepEqual(w.installer.log,[]);assert.equal(w.installer.version,'1.3.0','the other operation is not rolled back');
 w.installer.version='1.2.0';w.installer.install=install;w.backups.runs.push({backupId:'bkp_retry'});w.backups.listed.push('bkp_retry');await call('updates.apply',w.ctx,{to:'1.3.0'});assert.equal(w.installer.version,'1.3.0','the failed request released its guard');
});
