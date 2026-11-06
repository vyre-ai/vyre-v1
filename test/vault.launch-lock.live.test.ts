// The launch lock on a Team Space server, end to end (owner, 4 Nov: lock at launch; the key stays in the device's memory and one password unlocks everything). A booted server-role daemon with a member who
// has a real key bundle, her own Claude sign-in in Mine and the Space AI key standing by. The app side is the real client code (remoteGateState, serverKeyState, passwordKeyState, unlockWithPassword)
// talking to the daemon through the Space's https key door. Three moments:
//   1. the key is held on the server: her turn runs on her Mine sign-in, and the launch check goes straight in;
//   2. the app is relaunched after the server restarted (no device holds the key): the launch check says "locked"; with Not now her chat is answered by the Space key under the one line that says why;
//   3. she unlocks with her password: the key is held, her next turn runs on her Mine sign-in, and the launch check goes straight in.
import { MINE_CLOSED } from "../modules/vault/handlers/items.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forgetKey, keyIsKept, rehandKey } from "../client/src/gateway/key-keeper.ts";
import { serverKeyState } from "../client/src/gateway/local-key.ts";
import { passwordKeyState, remoteGateState, unlockWithPassword } from "../apps/app/src/shell/session/key-unlock.ts";
import { LOCKED_SPACE_KEY_LINE } from "../modules/engine/locked-account.ts";
import { boot, hostLog, seededDir } from "./memory-live-kit.ts";
import { PASSWORD, SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SPACE_URL = "https://team.firm.test";

test("launch lock on a Space server: held, goes straight in; relaunched with the key lost, locked; Not now leaves her chat on the Space key with its one line; Unlock brings her Mine sign-in back", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const start = (): Promise<Daemon> => boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  let d = await start();
  const realFetch = globalThis.fetch;
  // the app reaches the Space at its https address; here that address is the daemon, as Caddy hands it on
  const through = (): void => {
    globalThis.fetch = ((url: unknown, init?: RequestInit) => realFetch(String(url).replace(SPACE_URL, d.url), { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" } })) as typeof fetch;
  };
  const gate = (token: string) => remoteGateState({
    kept: keyIsKept, rehand: () => rehandKey(SPACE_URL, token),
    serverHolds: async () => { const k = await serverKeyState(SPACE_URL, token); return k === null ? null : k.held; },
    passwordKey: () => passwordKeyState(SPACE_URL, token),
  });
  try {
    through();
    assert.equal((await realFetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    // 1. Sara signs in with her password on this device: the key reaches the server, her Mine Claude answers, and the launch check goes straight in
    const sara = await join(d, "sara");
    assert.equal((await door(d, sara.token, "unlock", sara.personKey)).status, 204);
    const ref = await connectClaude(d, sara.token, "Sara_Claude", { spaceUse: false });
    const mine = `ran for ${sara.personId} on subscription ${ref}`;
    assert.equal((await ask(d, agentId, sara, "held")).reply, mine);
    assert.equal(await gate(sara.token), "open", "the server holds the key: nothing to ask");

    // 2. the server restarts and the app is relaunched: no device holds the key
    await d.stop();
    d = await start();
    through();
    forgetKey();
    assert.equal(await gate(sara.token), "locked", "relaunched, the server lost it, nobody holds it, she has a password: the lock shows");
    // Not now: her Mine sign-in stays closed and the chat is answered by the Space AI key, under the one line that says why
    const closed = await ask(d, agentId, sara, "not now");
    assert.equal(closed.reply, `ran for ${sara.personId} on the space key`);
    const lines = ((await api(d, sara.token, "chat.messages.list", { threadId: closed.threadId })).data.messages as Array<{ blocks?: Array<{ data?: { text?: string } }> }>).flatMap((m) => (m.blocks ?? []).map((b) => b.data?.text ?? ""));
    assert.ok(lines.includes(LOCKED_SPACE_KEY_LINE), `the chat says why in one line: ${JSON.stringify(lines)}`);

    // the refusal reads as a locked key, in plain words, and never as a sign-out
    const items = (await api(d, sara.token, "vault.items.list", {})).data.items as Array<{ id: string }>;
    const revealed = await api(d, sara.token, "vault.item.reveal", { itemId: items[0]!.id, idempotencyKey: "reveal-locked" });
    assert.equal(revealed.status, 401);
    const err = (revealed.data as { error?: { message?: string; details?: { reason?: string } } }).error!;
    assert.equal(err.message, MINE_CLOSED);
    assert.equal(err.details?.reason, "vault_locked", "the app reads the reason, so the person stays signed in");

    // 3. Unlock: the password opens the key, it goes to the server and stays in the app's memory; her Mine sign-in answers again
    await assert.rejects(unlockWithPassword(SPACE_URL, sara.token, "not the password"), /not right/);
    await unlockWithPassword(SPACE_URL, sara.token, PASSWORD);
    assert.equal(keyIsKept(), true);
    assert.equal(((await (await door(d, sara.token, "status")).json()) as { held: boolean }).held, true);
    assert.match(hostLog(d), /vault\.wrap_made/, "the unlock wrote the server's wrap of her key (it opens again after a Google or Microsoft sign-in without asking)");
    assert.equal((await ask(d, agentId, sara, "unlocked")).reply, mine, "her Mine sign-in answers after Unlock");
    assert.equal(await gate(sara.token), "open");
  } finally {
    globalThis.fetch = realFetch;
    forgetKey();
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
