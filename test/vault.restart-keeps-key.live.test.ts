// The owner's P0 ("every time I update it loses my credentials"), as decided: no key on disk. A daemon that restarts behind an open app gets the key back from the app's memory, silently, with no prompt; quit and
// relaunch (or an update) leaves the key absent until the one password entry hands it over, after which every old Mine item opens as it did, with no reconnect. Real daemons on one data folder; the app's side is
// the real client code (client/src/gateway: status, hold, the session keeper). The password step itself is the same hand-over route, called with the key the password would open.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, ok, scriptedModel, seededDir, stop } from "./support/eco-live.ts";
import { holdKeyOnOwnNode, keyHeldOnOwnNode } from "../client/src/gateway/local-key.ts";
import { forgetKey, keepKey, rehandKey } from "../client/src/gateway/key-keeper.ts";

const SECRET = "fth_restart_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255);

test("a restart behind an open app: the key comes back silently; a relaunch locks once, and one entry opens the old items", async () => {
  const dir = seededDir();
  const model = scriptedModel(async function* () { /* no turns here */ });
  let d = await boot(dir, model, { vault: undefined });
  let itemId = "";
  try {
    assert.equal(await keyHeldOnOwnNode(d.url, d.token), false, "a fresh daemon holds no key");
    // the one entry at launch: the password opens the key, the app hands it over and keeps it in memory for the session
    assert.equal(await holdKeyOnOwnNode(d.url, d.token, KEY), true);
    keepKey(KEY);
    assert.equal(await keyHeldOnOwnNode(d.url, d.token), true);
    const folder = (await ok(d, "vault.folders.create", { idempotencyKey: "rk-f", name: "Mine", scope: "mine" })).folder.id as string;
    itemId = (await ok(d, "vault.item.put", { idempotencyKey: "rk-put", folderId: folder, name: "Restart_Key", kind: "api_key", fields: [{ key: "api_key", value: SECRET, secret: true }] })).item.id as string;
    assert.equal((await call(d, "vault.item.reveal", { itemId, field: "api_key" })).status, 200);
  } finally { await stop(d); }

  // 1. the daemon restarts behind the open app (a crash, the sidecar restarting): the app still has the key and hands it back, no prompt
  d = await boot(dir, model, { vault: undefined });
  try {
    assert.equal(await keyHeldOnOwnNode(d.url, d.token), false, "the restarted daemon starts locked");
    assert.equal((await call(d, "vault.item.reveal", { itemId, field: "api_key" })).status, 401, "locked until the key is handed back");
    assert.equal(await rehandKey(d.url, d.token), true, "the app hands the key back by itself");
    const again = await call(d, "vault.item.reveal", { itemId, field: "api_key" });
    assert.equal(again.status, 200, "the old item opens: no reconnect, no password");
  } finally { await stop(d); }

  // 2. quit and relaunch, or an update: nothing is kept anywhere, so the app shows its lock screen once
  forgetKey();
  d = await boot(dir, model, { vault: undefined });
  try {
    assert.equal(await rehandKey(d.url, d.token), false, "a relaunched app has no key to hand over");
    assert.equal(await keyHeldOnOwnNode(d.url, d.token), false, "so the daemon stays locked and the lock screen is shown");
    // the one password entry: the key it opens is handed over, and the items from before the update open
    assert.equal(await holdKeyOnOwnNode(d.url, d.token, KEY), true);
    assert.equal((await call(d, "vault.item.reveal", { itemId, field: "api_key" })).status, 200, "the old item opens after the one entry");
  } finally { forgetKey(); await stop(d); }
});
