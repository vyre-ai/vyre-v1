// Keys reopen after a restart or a deploy with nothing to type (owner ruling 3 Nov). A Team Space server is restarted in the middle of two members' sessions:
//   Rubab signed in with Google: the server's own wrap of her key opens again for her still-live session, so her next turn runs on her own Claude.
//   Sara signed in with her password: her app kept the key it opened at sign-in, in memory, and hands it back through the Space's key door when it reconnects (the client's rehandKey), so her next
//   turn runs on her own Claude too. Nobody is asked for a password. A Space AI key stands by, so a key that did not reopen shows as a turn on it rather than a silent wait.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createIdp } from "../fixtures/suite/idp.ts";
import { forgetKey, keepKey, rehandKey } from "../client/src/gateway/key-keeper.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const ISSUER = "https://accounts.google.com";
const CLIENT = "firm-app-client";
const SECRET = "client-secret-value-123";
const DOMAIN = "firm.test";
const EMAIL = `rubab@${DOMAIN}`;
const SPACE_URL = "https://team.firm.test";

test("Team server restart: a Google member's key reopens from the server's wrap, a password member's app hands its kept key back; both next turns run on their own Claude, nothing typed", async () => {
  const idp = createIdp({ issuer: ISSUER, clientId: CLIENT, secret: SECRET });
  const stub = await vendor();
  const dir = seededDir();
  const reply = (a: { status?: number; json?: unknown; text?: string } | undefined) => {
    const body = a?.text ?? (a?.json === undefined ? "" : JSON.stringify(a.json));
    return { status: a?.status ?? (a === undefined ? 404 : 200), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: () => null as string | null } };
  };
  const start = (): Promise<Daemon> => boot(dir, standIn, undefined, {
    vault: undefined,
    seams: { fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => reply(await idp.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body })) },
  } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  let d = await start();
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const folder = await ok(d, d.token, "vault.folders.create", { name: "Company connections", scope: "shared" });
    await ok(d, d.token, "vault.item.put", { folderId: folder.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SECRET, secret: true }] });
    await ok(d, d.token, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: DOMAIN } });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    // Rubab joins with her password once, connects her Claude, then lives on Google sign-ins
    const rubab = await join(d, "rubab", EMAIL);
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    const rubabRef = await connectClaude(d, rubab.token, "Rubab_Claude", { spaceUse: false });
    await ok(d, rubab.token, "identity.sign_out", {});
    const google = async (): Promise<string> => {
      const s = await fetch(`${d.url}/auth/sso/google/start?return=${encodeURIComponent(`${d.url}/app`)}`, { redirect: "manual" });
      const to = new URL(s.headers.get("location")!);
      const cookie = s.headers.get("set-cookie")!.split(";")[0]!;
      const back = await fetch(`${d.url}/auth/sso/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=${encodeURIComponent(idp.approve(to.toString(), { sub: "rubab-google-id", email: EMAIL, email_verified: true, hd: DOMAIN }))}`, { redirect: "manual", headers: { cookie } });
      const fragment = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
      const signed = await api(d, null, "identity.sso_sign_in", { provider: "google", code: fragment.get("sso_code"), state: "-", deviceName: "Chrome", deviceClass: "web" });
      assert.equal(signed.status, 200, JSON.stringify(signed.data));
      return signed.data.session.token as string;
    };
    const rubabGoogle = await google();

    // Sara signs in with her password: her app opens the key, hands it over and keeps it in memory (key-keeper.ts)
    const sara = await join(d, "sara");
    assert.equal((await door(d, sara.token, "unlock", sara.personKey)).status, 204);
    keepKey(sara.personKey, sara.token);
    const saraRef = await connectClaude(d, sara.token, "Sara_Claude", { spaceUse: false });

    assert.equal((await ask(d, agentId, { token: rubabGoogle }, "before")).reply, `ran for ${rubab.personId} on subscription ${rubabRef}`);
    assert.equal((await ask(d, agentId, sara, "before")).reply, `ran for ${sara.personId} on subscription ${saraRef}`);

    // the server restarts (a deploy): every key in memory is gone
    await d.stop();
    d = await start();
    assert.equal(((await (await door(d, sara.token, "status")).json()) as { held: boolean }).held, false, "Sara's key went with the restart");

    // Rubab: still signed in with Google, nothing typed, her own Claude answers
    assert.equal((await ask(d, agentId, { token: rubabGoogle }, "after the restart")).reply, `ran for ${rubab.personId} on subscription ${rubabRef}`);
    const reopened = ((await ok(d, d.token, "audit.list", { limit: 50 })).rows as Array<{ action: string; onBehalfOf?: { id: string } }>).filter((r) => r.action === "vault.key_reopened_after_restart");
    assert.deepEqual(reopened.map((r) => r.onBehalfOf?.id), [rubab.personId], "the reopen is an audit row for her");

    // Sara: her app reconnects and hands the kept key back through the Space's https door, with no prompt
    const viaDoor: typeof fetch = (url, init) => fetch(String(url).replace(SPACE_URL, d.url), { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" } });
    assert.equal(await rehandKey(SPACE_URL, sara.token, viaDoor), true);
    assert.equal((await ask(d, agentId, sara, "after the restart")).reply, `ran for ${sara.personId} on subscription ${saraRef}`);
    forgetKey();
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
