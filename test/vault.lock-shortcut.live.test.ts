// Lock Vyre (Cmd-L, owner 4 Nov) end to end on a Team server, with the app's own client code: unlocked, her Mine Claude answers; Lock clears the key from the app and the server forgets it for her in this
// Space, so the next turn says locked (the Space key answers, under the one line, with Unlock); Unlock with the password restores it and her Mine Claude answers again. The server's wrap is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forgetKey, keyIsKept } from "../client/src/gateway/key-keeper.ts";
import { dropKeyOnOwnNode, serverKeyState } from "../client/src/gateway/local-key.ts";
import { unlockWithPassword } from "../apps/app/src/shell/session/key-unlock.ts";
import { LOCKED_SPACE_KEY_LINE } from "../modules/engine/locked-account.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { PASSWORD, SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";

const SPACE_URL = "https://team.firm.test";

test("lock clears the app's key and the server's, the next turn says locked and runs on the Space key; unlock restores her own sign-in", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => realFetch(String(url).replace(SPACE_URL, d.url), { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" } })) as typeof fetch;
  try {
    assert.equal((await realFetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
    const sara = await join(d, "sara");
    const token = ((await api(d, null, "identity.sign_in", { username: "sara", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop" })).data as { session: { token: string } }).session.token;
    await unlockWithPassword(SPACE_URL, token, PASSWORD);
    const ref = await connectClaude(d, token, "Sara_Claude", { spaceUse: false });
    const mine = `ran for ${sara.personId} on subscription ${ref}`;
    assert.equal((await ask(d, agentId, { token }, "unlocked")).reply, mine);

    // Cmd-L: what KeyGate does: the key leaves the app's memory and the server is told to forget it
    forgetKey();
    await dropKeyOnOwnNode(SPACE_URL, token);
    assert.equal(keyIsKept(), false, "the app holds no key");
    assert.deepEqual([(await serverKeyState(SPACE_URL, token))?.held, ((await (await door(d, token, "status")).json()) as { held: boolean }).held], [false, false], "and neither does the server");
    const locked = await ask(d, agentId, { token }, "locked");
    assert.equal(locked.reply, `ran for ${sara.personId} on the space key`, "her own sign-in does not answer");
    const lines = ((await api(d, token, "chat.messages.list", { threadId: locked.threadId })).data.messages as Array<{ blocks?: Array<{ data?: { text?: string; state?: string } }> }>).flatMap((m) => (m.blocks ?? []).map((b) => b.data ?? {}));
    const said = lines.find((l) => l.text === LOCKED_SPACE_KEY_LINE);
    assert.ok(said, `the chat says so in one line: ${JSON.stringify(lines)}`);
    assert.equal(said.state, "key_locked", "the line carries Unlock");
    // a Mine item will not open either
    const items = (await api(d, token, "vault.items.list", {})).data.items as Array<{ id: string }>;
    const revealed = await api(d, token, "vault.item.reveal", { itemId: items[0]!.id, idempotencyKey: "reveal-after-lock" });
    assert.equal(revealed.status, 401);

    // Unlock: the password sheet's call
    await unlockWithPassword(SPACE_URL, token, PASSWORD);
    assert.equal(keyIsKept(), true);
    assert.equal((await serverKeyState(SPACE_URL, token))?.held, true);
    assert.equal((await ask(d, agentId, { token }, "unlocked again")).reply, mine, "her own sign-in answers again");
  } finally {
    globalThis.fetch = realFetch;
    forgetKey();
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
