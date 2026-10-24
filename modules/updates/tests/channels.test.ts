// updates: channels, the signed manifest, check, status, compatibility, health (P-L7b_06; spec 3.10, b13): a bad signature is refused, apply backs up first.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { keyPair, manifestText, NOW, SHA, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureUpdates, handlers } from "../handlers/index.ts";
import { appSupported, appWindow, compareVersions, fromBase64, parseManifest, parseVersion, verifySignature } from "../handlers/channels.ts";
import type { UpdateCtx } from "../handlers/channels.ts";
import * as impl from "../impl.ts";

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
  await w.publish({ version: "1.3.0", notes: "Faster sync.", apps: { mac: "1.3.0", ios: "1.1.0", android: "0.9.0", web: "1.3.2" } });
  return w;
}

afterEach(() => configureUpdates(null));

test("a signature made with the release key verifies; any other does not", async () => {
  const k = await keyPair();
  const other = await keyPair();
  const text = manifestText({ version: "1.3.0" });
  const sig = await k.sign(text);
  assert.equal(await verifySignature(text, sig, k.publicKey), true);
  assert.equal(await verifySignature(text, await other.sign(text), k.publicKey), false, "signed by another key");
  assert.equal(await verifySignature(`${text} `, sig, k.publicKey), false, "a changed manifest");
  assert.equal(await verifySignature(text, sig.slice(0, -4), k.publicKey), false, "a short signature");
  assert.equal(await verifySignature(text, "not base64!!", k.publicKey), false);
  assert.equal(await verifySignature(text, sig, k.publicKey.slice(0, 31)), false, "a key of the wrong length");
  assert.equal(fromBase64("AAAA")?.length, 3);
  assert.equal(fromBase64("AAA"), null);
});

test("a bad signature is refused: nothing is read, stored or installed", async () => {
  const w = await ready();
  const text = manifestText({ version: "1.9.0" });
  const rogue = await keyPair();
  w.feed.answers.set("stable", { manifest: text, signature: await rogue.sign(text) });
  for (const name of ["updates.check", "updates.apply"]) {
    const err = await failed(call(name, w.ctx, {}));
    assert.equal(err.error.code, "provider.bad_response", name);
    assert.match(err.error.message, /signature does not match/);
  }
  assert.deepEqual(w.raw.rows("updates_state"), [], "the refused manifest left no trace");
  assert.deepEqual(w.installer.log, []);
  assert.deepEqual(w.backups.calls, [], "no backup was taken for an update that cannot happen");
  assert.deepEqual(w.events, []);
});

test("a manifest changed after it was signed is refused", async () => {
  const w = await ready();
  const signed = w.feed.answers.get("stable")!;
  w.feed.answers.set("stable", { manifest: signed.manifest.replace("1.3.0", "9.9.9"), signature: signed.signature });
  const err = await failed(call("updates.check", w.ctx, {}));
  assert.equal(err.error.code, "provider.bad_response");
});

test("a signed manifest for another channel, or in a shape this server does not read, is refused", async () => {
  const w = await ready();
  const sign = async (text: string) => w.feed.answers.set("stable", { manifest: text, signature: await w.key.sign(text) });
  const refuse = async (why: RegExp): Promise<void> => {
    const err = await failed(call("updates.check", w.ctx, {}));
    assert.equal(err.error.code, "provider.bad_response");
    assert.match(err.error.message, why);
  };
  await sign(manifestText({ version: "1.3.0", channel: "beta" }));
  await refuse(/beta channel, not stable/);
  await sign(manifestText({ version: "1.3.0", v: 2 }));
  await refuse(/manifest version/);
  await sign(manifestText({ version: "next" }));
  await refuse(/no server version/);
  await sign(manifestText({ version: "1.3.0", sha256: "xyz" }));
  await refuse(/sha256/);
  await sign("not json");
  await refuse(/not JSON/);
  assert.deepEqual(w.raw.rows("updates_state"), []);
});

test("the manifest reader keeps the server entry and the apps on offer, and ignores kits and connectors", () => {
  const parsed = parseManifest(manifestText({ version: "1.3.0", security: true, notes: "n", apps: { mac: "1.3.0", bad: "x" } }), "stable");
  assert.ok("manifest" in parsed);
  if ("manifest" in parsed) {
    assert.deepEqual(parsed.manifest.server, { version: "1.3.0", tarball: "https://releases.example/vyre-1.3.0.tgz", sha256: SHA, notes: "n", security: true });
    assert.deepEqual(parsed.manifest.apps, [{ platform: "mac", version: "1.3.0" }]);
  }
});

test("check reports a newer version, its notes and the apps the new server will serve", async () => {
  const w = await ready();
  const out = await call("updates.check", w.ctx, {}) as { available?: string; notes?: string; supportedApps: string[] };
  assert.equal(out.available, "1.3.0");
  assert.equal(out.notes, "Faster sync.");
  // server 1.3.0 serves apps on minors 1 to 5: mac 1.3.0, ios 1.1.0 and web 1.3.2 are in; android 0.9.0 is not
  assert.deepEqual(out.supportedApps.sort(), ["ios 1.1.0", "mac 1.3.0", "web 1.3.2"]);
  assert.deepEqual(w.feed.asked, ["stable"]);
  const status = await call("updates.status", w.ctx, {});
  assert.deepEqual(status, { current: "1.2.0", channel: "stable", available: "1.3.0" });
});

test("check with nothing newer says so, and an older manifest never counts as an update", async () => {
  const w = await ready();
  await call("updates.check", w.ctx, {});
  await w.publish({ version: "1.2.0" });
  const same = await call("updates.check", w.ctx, {}) as { available?: string; notes?: string };
  assert.equal(same.available, undefined);
  assert.equal((await call("updates.status", w.ctx, {}) as { available?: string }).available, undefined, "the earlier answer was cleared");
  await w.publish({ version: "1.1.5" });
  const older = await call("updates.check", w.ctx, {}) as { available?: string };
  assert.equal(older.available, undefined);
});

test("a feed that cannot be reached is a provider error and changes nothing", async () => {
  const w = await ready();
  w.feed.down = true;
  const err = await failed(call("updates.check", w.ctx, {}));
  assert.equal(err.error.code, "provider.unavailable");
  assert.deepEqual(w.raw.rows("updates_state"), []);
});

test("the channel is chosen on its own: stable by default, beta and nightly on request, and the old answer is dropped", async () => {
  const w = await ready();
  assert.equal((await call("updates.status", w.ctx, {}) as { channel: string }).channel, "stable");
  await call("updates.check", w.ctx, {});
  assert.deepEqual(await call("updates.channel_set", w.ctx, { channel: "beta" }), { ok: true });
  const status = await call("updates.status", w.ctx, {}) as { channel: string; available?: string };
  assert.deepEqual([status.channel, status.available], ["beta", undefined], "the stable answer does not carry over");
  await assert.rejects(call("updates.check", w.ctx, {}), VyreErr, "the beta channel has no release yet and says so");
  assert.deepEqual(w.feed.asked, ["stable", "beta"]);
  await w.publish({ version: "1.4.0-beta.2", channel: "beta" });
  const out = await call("updates.check", w.ctx, {}) as { available?: string };
  assert.equal(out.available, "1.4.0-beta.2");
  await call("updates.channel_set", w.ctx, { channel: "nightly" });
  assert.equal((await call("updates.status", w.ctx, {}) as { channel: string }).channel, "nightly");
  const err = await failed(call("updates.channel_set", w.ctx, { channel: "weekly" }));
  assert.equal(err.error.code, "validation.bad_input");
  // setting the same channel again keeps the last answer
  await w.publish({ version: "1.5.0-nightly.1", channel: "nightly" });
  await call("updates.check", w.ctx, {});
  await call("updates.channel_set", w.ctx, { channel: "nightly" });
  assert.equal((await call("updates.status", w.ctx, {}) as { available?: string }).available, "1.5.0-nightly.1");
});

test("apply backs up first: the backup is taken and listed before the update starts, and the install comes after", async () => {
  const w = await ready();
  await call("updates.apply", w.ctx, {});
  assert.deepEqual(w.backups.calls, ["backup.run@0", "backup.list@0"], "both backup calls happened before the installer was touched");
  assert.deepEqual(w.installer.log, ["install 1.3.0"]);
  assert.deepEqual(w.events.map((e) => e.name), ["update.started", "update.completed"]);
  assert.equal(w.raw.rows("updates_history")[0]!["backup_id"], "bkp_first1");
});

test("if the backup cannot be taken the server is not touched", async () => {
  const w = await ready();
  w.backups.runError = "Choose where backups go first.";
  const err = await failed(call("updates.apply", w.ctx, {}));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /takes a backup first/);
  assert.match(err.error.message, /Choose where backups go first/);
  assert.deepEqual(w.installer.log, []);
  assert.deepEqual(w.events, []);
  assert.deepEqual(w.raw.rows("updates_history"), []);
});

test("a backup that ran but did not finish does not count", async () => {
  const w = await ready();
  w.backups.listed = [];
  const err = await failed(call("updates.apply", w.ctx, {}));
  assert.equal(err.error.code, "validation.precondition_failed");
  assert.match(err.error.message, /did not finish/);
  assert.deepEqual(w.installer.log, []);
});

test("app compatibility: the server supports apps within two minor versions, older apps update first", async () => {
  const w = await ready();
  assert.deepEqual(await call("updates.app_compat", w.ctx, {}), { min: "1.0.0", max: "1.4.9999", updateRequiredBelow: "1.0.0" });
  w.installer.version = "2.5.1";
  assert.deepEqual(await call("updates.app_compat", w.ctx, {}), { min: "2.3.0", max: "2.7.9999", updateRequiredBelow: "2.3.0" });
  w.installer.version = "0.1.0";
  assert.deepEqual(await call("updates.app_compat", w.ctx, {}), { min: "0.0.0", max: "0.3.9999", updateRequiredBelow: "0.0.0" });
  assert.equal(appWindow("nope"), null);
  assert.equal(appSupported("1.4.0", "1.2.9"), true);
  assert.equal(appSupported("1.4.0", "1.1.9"), false, "three minors behind");
  assert.equal(appSupported("1.4.0", "1.6.2"), true);
  assert.equal(appSupported("1.4.0", "1.7.0"), false, "three minors ahead");
  assert.equal(appSupported("1.4.0", "2.4.0"), false, "another major");
  assert.equal(appSupported("1.4.0", "not a version"), false);
});

test("versions order as semver, with prereleases before their release", () => {
  const order = ["1.0.0-beta.2", "1.0.0-beta.10", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compareVersions(order[i]!, order[i + 1]!), -1, `${order[i]} < ${order[i + 1]}`);
    assert.equal(compareVersions(order[i + 1]!, order[i]!), 1);
  }
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(parseVersion("v1.2.3"), null);
  assert.throws(() => compareVersions("x", "1.0.0"), /not a version/);
});

test("history lists updates newest first", async () => {
  const w = await ready();
  await call("updates.apply", w.ctx, {});
  w.setNow(NOW + 60_000);
  w.backups.runs.push({ backupId: "bkp_second" });
  w.backups.listed = ["bkp_second"];
  await call("updates.rollback", w.ctx, { to: "1.2.0" });
  const out = await call("updates.history", w.ctx, {}) as { updates: { from: string; to: string; result: string; at: number; seconds: number }[] };
  assert.deepEqual(out.updates.map((u) => [u.from, u.to, u.result]), [["1.3.0", "1.2.0", "rolled_back"], ["1.2.0", "1.3.0", "ok"]]);
  assert.equal(out.updates[0]!.at, NOW + 60_000);
});

test("health: failed last update, a waiting security update and a stale check are degraded", async () => {
  const w = await ready();
  assert.deepEqual(await call("updates.health", w.ctx, {}), { state: "healthy", latencyMs: 0 });
  await w.publish({ version: "1.3.1", security: true });
  await call("updates.check", w.ctx, {});
  const sec = await call("updates.health", w.ctx, {}) as { state: string; detail: string };
  assert.equal(sec.state, "degraded");
  assert.match(sec.detail, /security update \(1\.3\.1\)/);
  w.installer.health = [false, true];
  await call("updates.apply", w.ctx, {});
  const bad = await call("updates.health", w.ctx, {}) as { state: string; detail: string };
  assert.equal(bad.state, "degraded");
  assert.match(bad.detail, /last update to 1\.3\.1 failed/);
  // a clean state with an old look
  const fresh = await ready();
  await call("updates.check", fresh.ctx, {});
  fresh.setNow(NOW + 8 * 86_400_000);
  const stale = await call("updates.health", fresh.ctx, {}) as { state: string; detail: string };
  assert.equal(stale.state, "degraded");
  assert.match(stale.detail, /over a week/);
});

test("the drivers must be wired", async () => {
  const w = await ready();
  configureUpdates(null);
  const err = await failed(call("updates.status", w.ctx, {}));
  assert.equal(err.error.code, "internal.unavailable");
});

test("impl.ts exposes every updates handler, the host wiring and no projections", () => {
  assert.equal(impl.handlers, handlers);
  assert.equal(impl.configureUpdates, configureUpdates);
  assert.deepEqual(impl.projections, []);
  assert.deepEqual(impl.inline, {});
  assert.deepEqual(impl.consumers, {});
  assert.deepEqual(impl.codecs, {});
  assert.deepEqual(Object.keys(impl.handlers).sort(), ["updates.app_compat", "updates.apply", "updates.channel_set", "updates.check", "updates.health", "updates.history", "updates.rollback", "updates.status"]);
});
