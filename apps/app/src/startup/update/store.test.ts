// The page's bridge to the shell's update commands, the shared state behind the Settings row and the rail dot, and the build's What's new.
import test from "node:test";
import assert from "node:assert/strict";
import { PROGRESS_EVENT, desktopUpdates, loadWhatsNew, readCheck, readProgress, resetUpdateState, resetWhatsNew, setUpdateState, subscribeUpdates, updateState, updateWaiting } from "./store.ts";
import { fetchWhatsNew } from "../../../../../client/src/gateway/whats-new.ts";

test("a browser has no shell, so no update commands", () => {
  assert.equal(desktopUpdates(undefined), undefined);
  assert.equal(desktopUpdates({}), undefined);
});

test("the start asks the shell with a bounded wait, Check now asks again, and the answers are read strictly", async () => {
  const calls: Array<[string, unknown]> = [];
  const u = desktopUpdates({ core: { invoke: async (cmd, args) => { calls.push([cmd, args]); return { current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: "Faster.", checkedAt: 5, phase: "available" }; } } })!;
  assert.deepEqual(await u.startup(2500), { phase: "available", current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: "Faster.", checkedAt: 5 });
  await u.startup(1e9);
  await u.check();
  assert.deepEqual(calls, [["startup_update", { waitMs: 2500 }], ["startup_update", { waitMs: 10_000 }], ["check_desktop_update", undefined]], "the wait is capped and Check now passes nothing");
  assert.deepEqual(readCheck({ current: "1.0.0", channel: "stable" }), { phase: "none", current: "1.0.0", channel: "stable", version: null, notes: null, checkedAt: null });
  assert.equal(readCheck({ current: "1.0.0", channel: "stable", phase: "checking" }).phase, "checking");
  assert.throws(() => readCheck({}), /could not read/);
  assert.throws(() => readCheck(null), /could not read/);
  await assert.rejects(() => desktopUpdates({ core: { invoke: async () => { throw "Couldn't reach the update server."; } } })!.check(), /reach the update server/);
});

test("install hears each step of the shell's progress and stops listening when it ends, success or not", async () => {
  const heard: unknown[] = [];
  let handler: ((e: { payload: unknown }) => void) | null = null;
  let unlistened = 0;
  const invokes: string[] = [];
  const tauri = {
    core: { invoke: async (cmd: string) => { invokes.push(cmd); handler?.({ payload: { phase: "download", downloaded: 10, total: 100 } }); handler?.({ payload: { phase: "bogus" } }); handler?.({ payload: { phase: "waiting", downloaded: 0, total: null, turns: 2 } }); if (invokes.length > 1) throw new Error("The update did not install: disk full"); return undefined; } },
    event: { listen: async (event: string, h: (e: { payload: unknown }) => void) => { assert.equal(event, PROGRESS_EVENT); handler = h; return () => { unlistened++; handler = null; }; } },
  };
  const u = desktopUpdates(tauri)!;
  await u.install((p) => heard.push(p));
  assert.deepEqual(heard, [{ phase: "download", downloaded: 10, total: 100 }, { phase: "waiting", downloaded: 0, total: null, turns: 2 }], "an unknown step is dropped");
  await assert.rejects(() => u.install((p) => heard.push(p)), /disk full/);
  assert.equal(unlistened, 2);
  assert.deepEqual(invokes, ["install_desktop_update", "install_desktop_update"], "install passes the shell nothing");
  assert.equal(readProgress({ phase: "download", downloaded: -4, total: 0 })?.total, null);
});

test("the Settings row and the rail dot follow one state: a newer version waiting and not being installed", () => {
  resetUpdateState();
  let told = 0;
  const off = subscribeUpdates(() => { told++; });
  assert.equal(updateWaiting(updateState()), false);
  setUpdateState({ check: { phase: "available", current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: null, checkedAt: 1 } });
  assert.equal(updateWaiting(updateState()), true);
  setUpdateState({ installing: true });
  assert.equal(updateWaiting(updateState()), false, "no dot while it installs");
  setUpdateState({ installing: false, check: { phase: "none", current: "1.0.0-rc.17", channel: "beta", version: null, notes: null, checkedAt: 2 } });
  assert.equal(updateWaiting(updateState()), false);
  off();
  setUpdateState({ installing: false });
  assert.equal(told, 3);
  resetUpdateState();
});

test("the build's What's new is read once per open, and offline is nothing", async () => {
  resetWhatsNew();
  let reads = 0;
  const read = async (): Promise<unknown> => { reads++; return { version: "1.0.0-rc.17", lines: ["Vyre updates itself."] }; };
  assert.deepEqual(await loadWhatsNew(read), { version: "1.0.0-rc.17", lines: ["Vyre updates itself."] });
  await loadWhatsNew(read);
  assert.equal(reads, 1);
  resetWhatsNew();
  assert.equal(await loadWhatsNew(async () => { throw new Error("offline"); }), null);
  resetWhatsNew();
  const asked: Array<[string, unknown]> = [];
  assert.deepEqual(await fetchWhatsNew(async (url, init) => { asked.push([url, init]); return { ok: true, json: async () => ({ version: "1", lines: [] }) }; }), { version: "1", lines: [] });
  assert.deepEqual(asked, [["/whats-new.json", { cache: "no-store" }]]);
  assert.equal(await fetchWhatsNew(async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await fetchWhatsNew(async () => { throw new Error("offline"); }), null);
  assert.equal(await fetchWhatsNew(undefined), null);
});

test("readProgress carries the chats a wait names and the seconds left, and drops what it cannot read", () => {
  assert.deepEqual(readProgress({ phase: "waiting", downloaded: 0, total: null, turns: 2, chats: ["Rivera intake", "", 5, "Weekly update"], left: 300, of: 600 }), { phase: "waiting", downloaded: 0, total: null, turns: 2, chats: ["Rivera intake", "Weekly update"], left: 300, of: 600 });
  assert.deepEqual(readProgress({ phase: "waiting", turns: 1, chats: "no", left: -4 }), { phase: "waiting", downloaded: 0, total: null, turns: 1 });
});
