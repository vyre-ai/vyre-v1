// TARGET (rc.9 P0, owner: "every time I update it loses my credentials"). Marked todo until the owner decides how the key may be kept across restarts. The person key is held in daemon memory only (host/src/seams/keyring.ts), so a restart loses it and every Mine item answers
// "Your vault key is locked" until a password sign-in hands it over again. This test states the wanted behaviour and FAILS on today's code: sign in, store a Mine key, restart the daemon on the same data
// folder (an app update does exactly this), and the key must still work with no sign-in. Nothing here touches a real install.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, ok, scriptedModel, seededDir, stop } from "./support/eco-live.ts";

const SECRET = "fth_restart_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake

test("a Mine key still opens after the daemon restarts on the same data folder, with no sign-in", { todo: "target: fails today by design; the person key is memory-only. Needs the owner's decision on holding it across restarts." }, async () => {
  const dir = seededDir();
  const model = scriptedModel(async function* () { /* no turns here */ });
  let d = await boot(dir, model, { vault: undefined });
  let itemId = "";
  try {
    const folder = await connect(d);
    const put = await ok(d, "vault.item.put", { idempotencyKey: "rk-put", folderId: folder, name: "Restart_Key", kind: "api_key", fields: [{ key: "api_key", value: SECRET, secret: true }] });
    itemId = put.item.id as string;
    assert.equal((await call(d, "vault.item.reveal", { itemId, field: "api_key" })).status, 200, "it opens while the person is signed in");
  } finally { await stop(d); }

  // the app updates: the daemon starts again on the same folder; nobody types a password
  d = await boot(dir, model, { vault: undefined });
  try {
    const again = await call(d, "vault.item.reveal", { itemId, field: "api_key" });
    assert.equal(again.status, 200, `after a restart the key must still open; got ${again.status} ${JSON.stringify(again.data).replace(SECRET, "<secret>").slice(0, 200)}`);
  } finally { await stop(d); }
});
