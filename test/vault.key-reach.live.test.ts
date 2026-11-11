// The person's key reaches the Space server so their own Mine sign-in answers their server turns (owner, 4 Nov: "everything in my Vault must be accessible to me, from any device"). A Team server, a member
// with two devices, a Space AI key standing by so a locked key shows as a turn on it:
//   1. a device that was resumed (a stored session, never unlocked here) runs its server turn on the member's Mine sign-in, because another device of theirs handed the key over;
//   2. the server restarts with the unlocked device's app still open: that app hands the kept key back when its link is live again, and the resumed device's next turn runs on the Mine sign-in too;
//   3. after the person signs out everywhere the key is gone: the next sign-in, with nothing handed over, is locked and the Space AI key answers instead.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forgetKey, handOnLive, keepKey, rehandKey } from "../client/src/gateway/key-keeper.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { PASSWORD, SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";

const SPACE_URL = "https://team.firm.test";

test("a resumed device's server turn runs on the member's Mine sign-in; after a restart the open app hands the key back; signed out everywhere it is locked again", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    // Sara signs in on her laptop with her password: the app opens the key, hands it to the Space and keeps it in memory
    const sara = await join(d, "sara");
    assert.equal((await door(d, sara.token, "unlock", sara.personKey)).status, 204);
    keepKey(sara.personKey, sara.token);
    const ref = await connectClaude(d, sara.token, "Sara_Claude", { spaceUse: false });
    const mine = `ran for ${sara.personId} on subscription ${ref}`;
    assert.equal((await ask(d, agentId, sara, "laptop")).reply, mine);

    // 1. her phone: a stored session, resumed, never unlocked (no key of its own, nothing handed over from it)
    const phone = (await api(d, null, "identity.sign_in", { username: "sara", password: PASSWORD, deviceName: "Phone", deviceClass: "phone" })).data as { session: { token: string } };
    const phoneToken = phone.session.token;
    assert.equal(((await (await door(d, phoneToken, "status")).json()) as { held: boolean }).held, true, "the server holds her key for her, whichever device asks");
    assert.equal((await ask(d, agentId, { token: phoneToken }, "phone")).reply, mine, "the resumed phone's turn runs on her Mine sign-in");

    // 2. the server restarts under her open laptop app: its link goes live again, so it hands the kept key back (handOnLive says so for the first live and for a return after a drop)
    assert.equal(handOnLive("offline", "live", true), true);
    await d.stop();
    const d2 = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
    try {
      assert.equal(((await (await door(d2, sara.token, "status")).json()) as { held: boolean }).held, false, "the restart took the key out of memory");
      const viaDoor: typeof fetch = (url, init) => fetch(String(url).replace(SPACE_URL, d2.url), { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" } });
      assert.equal(await rehandKey(SPACE_URL, sara.token, viaDoor), true);
      assert.equal((await ask(d2, agentId, { token: phoneToken }, "phone after the restart")).reply, mine, "the resumed phone runs on her Mine sign-in again");

      // 3. signed out everywhere: the key is gone, and a new sign-in that hands nothing over is locked, so the Space AI key answers
      forgetKey();
      await ok(d2, phoneToken, "identity.sign_out", {});
      await ok(d2, sara.token, "identity.sign_out", {});
      const again = (await api(d2, null, "identity.sign_in", { username: "sara", password: PASSWORD, deviceName: "Tablet", deviceClass: "phone" })).data as { session: { token: string } };
      assert.equal(((await (await door(d2, again.session.token, "status")).json()) as { held: boolean }).held, false, "locked again");
      assert.equal((await ask(d2, agentId, { token: again.session.token }, "tablet")).reply, "ran for " + sara.personId + " on the space key", "the Space AI key answers; her Mine sign-in stays closed");
    } finally { await d2.stop(); }
  } finally {
    forgetKey();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
