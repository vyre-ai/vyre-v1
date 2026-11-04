// The desktop app's own path to the server's wrap (owner, 4 Nov: on MLA only Andrey had a wrap, so after a restart the owner's Claude sign-in was never used). The app signs in with the password
// (identity.sign_in answers the key bundle), opens the bundle on the device and hands the key through the Space's https door, which writes the server's wrap (host_person_wrap). Real daemon; the
// client side is the app's own unlockWithPassword and the launch check (remoteGateState). Steps: sign in and unlock at launch, the wrap exists and the key is held; the server restarts; the relaunched
// app is told to lock; one unlock and the person's own Claude answers, the wrap still there.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forgetKey, keyIsKept, rehandKey } from "../client/src/gateway/key-keeper.ts";
import { serverKeyState } from "../client/src/gateway/local-key.ts";
import { passwordKeyState, remoteGateState, unlockWithPassword } from "../apps/app/src/shell/session/key-unlock.ts";
import { boot, hostLog, seededDir } from "./memory-live-kit.ts";
import { PASSWORD, SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SPACE_URL = "https://team.firm.test";

test("desktop path: sign in, unlock at launch writes the wrap; after a server restart the relaunched app locks, one unlock brings the person's own Claude back", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const start = (): Promise<Daemon> => boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  let d = await start();
  const realFetch = globalThis.fetch;
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
    const member = await join(d, "irfad");   // the account exists with a real key bundle; this device signs in fresh, as the desktop app does

    // the desktop app: a password sign-in on a new device answers the key bundle with the session
    const signed = (await api(d, null, "identity.sign_in", { username: "irfad", password: PASSWORD, deviceName: "Irfad's Mac", deviceClass: "desktop" })).data as { session: { token: string }; keys?: unknown };
    assert.ok(signed.keys, "the sign-in answers the key bundle, so the app can open it");
    const token = signed.session.token;
    // launch: the server holds no key yet, nobody else does, the account has a password: the lock shows; the password unlocks it through the Space door
    assert.equal(await gate(token), "locked");
    await unlockWithPassword(SPACE_URL, token, PASSWORD);
    assert.equal(keyIsKept(), true);
    const after = await serverKeyState(SPACE_URL, token);
    assert.deepEqual([after?.held, after?.remembered], [true, true], "held now, and the server wrote its wrap of the key");
    assert.match(hostLog(d), /vault\.wrap_made/);
    const ref = await connectClaude(d, token, "Irfad_Claude", { spaceUse: false });
    const mine = `ran for ${member.personId} on subscription ${ref}`;
    assert.equal((await ask(d, agentId, { token }, "before")).reply, mine);

    // the server restarts for an update; the app is relaunched (it holds no key now)
    await d.stop();
    d = await start();
    through();
    forgetKey();
    const lost = await serverKeyState(SPACE_URL, token);
    assert.deepEqual([lost?.held, lost?.remembered], [false, true], "the key went with the restart; the wrap is still there");
    assert.equal(await gate(token), "locked", "the relaunched app shows the unlock");
    // not unlocked yet: her own sign-in stays closed, and the chat is answered by the Space key with its one line, never silently
    const fallback = await ask(d, agentId, { token }, "locked");
    assert.equal(fallback.reply, `ran for ${member.personId} on the space key`);
    // one unlock, and the person's own Claude answers again
    await unlockWithPassword(SPACE_URL, token, PASSWORD);
    assert.equal(((await (await door(d, token, "status")).json()) as { held: boolean }).held, true);
    assert.equal((await ask(d, agentId, { token }, "unlocked")).reply, mine);
    assert.equal(await gate(token), "open");
  } finally {
    globalThis.fetch = realFetch;
    forgetKey();
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
