// The lock screen's real path, with a real password: a real claim makes the key bundle, the person's key goes to the daemon, a Mine item is stored; then the daemon restarts (quit and relaunch, an update) and
// the app's own code (`unlockWithPassword`, the one entry the lock screen runs) is used. A wrong password says so and opens nothing; the right password opens the old item with no reconnect; after that a daemon
// that restarts behind the open app gets the key back from the app's memory, with no prompt. Real daemons on one data folder, real Argon2id and AES via client/src/crypto. Only the model is absent: this proves
// the key, not a chat turn (see the real-browser proof, which needs the owner's Claude token and a built app).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { claimOwner } from "../apps/app/src/claim/claim.ts";
import { createCapCaller } from "../apps/app/src/shell/session/caps.ts";
import { unlockWithPassword, hasPasswordKey } from "../apps/app/src/shell/session/KeyGate.tsx";
import { holdKeyOnOwnNode, keyStatusOnOwnNode } from "../client/src/gateway/local-key.ts";
import { forgetKey, rehandKey } from "../client/src/gateway/key-keeper.ts";

const PASSWORD = "fixture lock password 9137"; // secret-scan: fake
const SECRET = "fth_lockscreen_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const SPACE = "spc_lock";
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

async function boot(dir: string) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", SPACE, "--space-name", "Lock", "--space-kind", "personal"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "lock-live", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

test("real password: relaunch shows the lock; wrong password opens nothing; the right one opens the old item; a restart behind the open app is silent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-lock-live-"));
  let d = await boot(dir);
  let session = "";
  let itemId = "";
  try {
    assert.ok(d.claim, "a fresh Space prints its claim link");
    const link = new URL(d.claim!.url);
    const anon = createCapCaller({ baseUrl: d.url, token: () => null });
    const claimed = await claimOwner({
      call: anon, makeBundle: (pw, rc, spaceId) => makeBundle(pw, rc, { spaceId }), wipe: (b) => b.fill(0),
      holdKey: (t, k) => holdKeyOnOwnNode(d.url, t, k),
    }, { token: link.pathname.slice("/claim/".length), spaceId: SPACE, name: "Lock owner", username: "lockowner", password: PASSWORD, recoveryCode: "recovery fixture 0123456789", deviceName: "lock live", deviceClass: "desktop" });
    session = claimed.token;
    const call = createCapCaller({ baseUrl: d.url, token: () => session });
    assert.equal(await keyStatusOnOwnNode(d.url, session), "held", "the claim handed the key to this computer");
    assert.equal(await hasPasswordKey(d.url, session), true, "this account has a password key to open");
    const folder = ((await call("vault.folders.create", { name: "Mine", scope: "mine" })) as { folder: { id: string } }).folder.id;
    itemId = ((await call("vault.item.put", { folderId: folder, name: "Lock_Key", kind: "api_key", fields: [{ key: "api_key", value: SECRET, secret: true }] })) as { item: { id: string } }).item.id;
  } finally { await d.stop(); }
  forgetKey(); // quit: the app's memory is gone with it

  // relaunch / update
  d = await boot(dir);
  try {
    assert.equal(await keyStatusOnOwnNode(d.url, session), "locked", "the lock screen is what a relaunch shows");
    assert.equal(await rehandKey(d.url, session), false, "the relaunched app has nothing to hand over");
    const reveal = (): Promise<Response> => fetch(`${d.url}/v1/vault/item/reveal`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session}` }, body: JSON.stringify({ itemId, field: "api_key" }) });
    assert.equal((await reveal()).status, 401, "locked: nothing opens");

    await assert.rejects(unlockWithPassword(d.url, session, "not the password"), /That password is not right\./);
    assert.equal(await keyStatusOnOwnNode(d.url, session), "locked", "a wrong password opens nothing");

    await unlockWithPassword(d.url, session, PASSWORD);
    assert.equal(await keyStatusOnOwnNode(d.url, session), "held");
    assert.equal((await reveal()).status, 200, "the old item opens with the one entry, no reconnect");
  } finally { await d.stop(); }

  // the daemon restarts behind the open app (the app kept the key in memory after the entry above)
  d = await boot(dir);
  try {
    assert.equal(await keyStatusOnOwnNode(d.url, session), "locked", "the restarted daemon starts locked");
    assert.equal(await rehandKey(d.url, session), true, "the app hands it back by itself");
    const r = await fetch(`${d.url}/v1/vault/item/reveal`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session}` }, body: JSON.stringify({ itemId, field: "api_key" }) });
    assert.equal(r.status, 200, "no prompt, and the item still opens");
  } finally { forgetKey(); await d.stop(); }
});
