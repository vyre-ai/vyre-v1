// Adding an AI key "Shared with the Space" with no folder chosen (owner, rc.16: it failed with "Choose the shared folder to keep it in"). The key goes in "AI accounts", made on first use and shared
// with Everyone at Use, and every person in the Space, whatever their role and however they sign in, gets a turn on it: the provider stand-in sees this very key on each of them. A second key
// goes in the same folder.
import test from "node:test";
import assert from "node:assert/strict";
import { api, chatUse, ok, sha12, teamRig } from "./support/vault-matrix.ts";

test("Team: a Space-shared AI key added with no folder chosen goes in AI accounts, and the whole team runs turns on it", { timeout: 60_000 }, async () => {
  const rig = await teamRig({ froms: ["desktop"] });
  try {
    const owner = rig.people.owner!.tokens.desktop!;
    const value = "sk-or-team-FAKE0123456789abcdef"; // secret-scan: fake
    const added = await api(rig.d, owner, "providers.add", { providerKey: "openrouter", connection: "api_key", apiKey: value, scope: "shared", idempotencyKey: "ssp-1" });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const folders = (await ok(rig.d, owner, "vault.folders.list", { scope: "shared" })).folders as Array<{ id: string; name: string }>;
    const ai = folders.find((f) => f.name === "AI accounts");
    assert.ok(ai, `made on first use: ${JSON.stringify(folders.map((f) => f.name))}`);
    const handle = added.data.provider.handle as string;
    const again = await api(rig.d, rig.people.admin!.tokens.desktop!, "providers.add", { providerKey: "openrouter", connection: "api_key", apiKey: `${value}2`, scope: "shared", idempotencyKey: "ssp-2" });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    const item = (await ok(rig.d, owner, "vault.item.get", { itemId: again.data.provider.itemId })).item as { folderId: string };
    assert.equal(item.folderId, ai!.id, "the second key goes in the same folder");
    for (const who of ["owner", "admin", "member", "member_sso"] as const) {
      const turn = await chatUse(rig, rig.people[who]!.tokens.desktop!, handle);
      assert.equal(turn.got, sha12(value), `${who}: ${JSON.stringify(turn)}`);
    }
    const peer = await chatUse(rig, rig.peer!.tokens.desktop!, handle);
    assert.equal(peer.got, sha12(value), `a member outside every group: ${JSON.stringify(peer)}`);
  } finally { await rig.stop(); }
});
