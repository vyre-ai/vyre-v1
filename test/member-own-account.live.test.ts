// A member's own AI account on a Team Space server (owner ruling 3 Nov, R62 amended), on a booted server-role daemon. Two members join from an invitation with real key bundles. Signing in hands the
// person key to the Space over its https door (POST /vault/key/unlock), bound to that session; the member connects a Claude sign-in (a fake one: the provider's flow is the existing test path) into
// their own Mine, and their chat turn runs on it. The other member cannot list or use it and runs on the Space AI key. Signing out drops the key: the next turn runs on the Space AI key and the chat
// says why in one line. The key never reaches a file of the data directory or a log line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wipe } from "../client/src/crypto/keys.ts";
import { boot, hostLog, seededDir } from "./memory-live-kit.ts";
import { LOCKED_SPACE_KEY_LINE } from "../modules/engine/locked-account.ts";
import { PASSWORD, SPACE_KEY, SUB, api, ask as askIn, connectClaude, door, filesHolding, join, ok, standIn, vendor } from "./member-key-kit.ts";

test("Team server: a member's sign-in opens their own Mine; their Claude runs their turns; nobody else's; sign-out falls back to the Space AI key with a line", async () => {
  const stub = await vendor();
  const dir = seededDir();
  // a Space server (role space): no person's own computer
  // the real Vault (the kit's default is a stand-in that answers every handle), so her Mine items really open with her key
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    // the owner sets the Space AI key every member falls back to, and an agent
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    const rubab = await join(d, "rubab");
    const sara = await join(d, "sara");

    // plain http from another machine is refused; the https door takes the key for her own session
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey, "http")).status, 403);
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    // held now, and kept sealed for a Google or GitHub sign-in (the policy is on by default; member-provider-signin.live.test.ts)
    assert.deepEqual(await (await door(d, rubab.token, "status")).json(), { held: true, remembered: true, forgotten: false });
    assert.deepEqual(await (await door(d, sara.token, "status")).json(), { held: false, remembered: false, forgotten: false }, "Sara's answer is her own");

    // Rubab connects her Claude (a fake sign-in) into her own Mine, from anywhere: no "opens on the computer your Space runs on"
    const mine = { ref: await connectClaude(d, rubab.token, "Rubab_Claude") };

    const ask = (who: { token: string; personId?: string }, text: string) => askIn(d, agentId, who, text);

    // her turn runs on her own Claude
    const first = await ask(rubab, "hello from rubab");
    assert.equal(first.reply, `ran for ${rubab.personId} on subscription ${mine.ref}`);
    // and the server can open it for her own turn: the fill an engine makes acting for her
    const filled = await api(d, rubab.token, "vault.use", { item: mine.ref.slice(1) });
    assert.equal(filled.status, 200, JSON.stringify(filled.data));

    // Sara: not listed, not usable by name, and her turn runs on the Space AI key
    const saraAccounts = (await ok(d, sara.token, "engine.accounts.list")).accounts as Array<{ ref: string; spaceKey?: boolean }>;
    assert.ok(!saraAccounts.some((a) => a.ref === mine.ref), "Rubab's Claude is not among Sara's accounts");
    const steal = await api(d, sara.token, "vault.use", { item: mine.ref.slice(1) });
    assert.ok([403, 404].includes(steal.status), `Sara cannot use Rubab's Claude: ${steal.status} ${JSON.stringify(steal.data)}`);
    assert.equal((await ask(sara, "hello from sara")).reply, `ran for ${sara.personId} on the space key`);

    // a second session of Rubab's (a browser that never handed the key over), then she signs out of the first: the key goes with it
    const browser = (await api(d, null, "identity.sign_in", { username: "rubab", password: PASSWORD, deviceName: "Chrome", deviceClass: "web" })).data.session.token as string;
    await ok(d, rubab.token, "identity.sign_out", {});
    assert.equal(((await (await door(d, browser, "status")).json()) as { held: boolean }).held, false, "signed out: the server no longer holds her key");
    const after = await ask({ personId: rubab.personId, token: browser }, "hello again from rubab");
    assert.equal(after.reply, `ran for ${rubab.personId} on the space key`, "her turn fell back to the Space AI key");
    const lines = ((await ok(d, browser, "chat.messages.list", { threadId: after.threadId })).messages as Array<{ blocks?: Array<{ type?: string; data?: { text?: string } }> }>)
      .flatMap((m) => m.blocks ?? []).filter((b) => b.type === "turn_status").map((b) => b.data?.text);
    assert.ok(lines.includes(LOCKED_SPACE_KEY_LINE), `the chat says why: ${JSON.stringify(lines)}`);

    // signing in again on that browser hands it over and her own account answers again
    assert.equal((await door(d, browser, "unlock", rubab.personKey)).status, 204);
    assert.equal((await ask({ personId: rubab.personId, token: browser }, "and again")).reply, `ran for ${rubab.personId} on subscription ${mine.ref}`);

    // nothing of hers in the clear on disk or in the logs
    d.sink.flush();
    for (const needle of [Buffer.from(rubab.personKey), Buffer.from(Buffer.from(rubab.personKey).toString("base64")), Buffer.from(SUB)]) assert.deepEqual(filesHolding(dir, needle), [], "not in any file in the clear");
    assert.ok(!hostLog(d).includes(SUB));
    wipe(rubab.personKey); wipe(sara.personKey);
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
