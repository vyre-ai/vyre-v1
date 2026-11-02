// Google sign-in (OpenID Connect) opens a member's own Vault with nothing to type (owner ruling 3 Nov, R62 amended), through the real identity path: the start address, the provider's signed ID token
// (the stand-in from fixtures/suite/idp.ts), the callback, identity.sso_sign_in, issueSession. The member typed their password once, at join, and their client handed the key over at the Space's door,
// so the server kept it sealed. After Google proves who it is, the key is open for that session only, the member's own Claude answers, and the audit log says it was Google.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createIdp } from "../fixtures/suite/idp.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, ask, connectClaude, door, join, ok, standIn } from "./member-key-kit.ts";

const ISSUER = "https://accounts.google.com";
const CLIENT = "firm-app-client";
const SECRET = "client-secret-value-123";
const DOMAIN = "firm.test";
const EMAIL = `rubab@${DOMAIN}`;

test("Team server: a member who signs in with Google types nothing; the Space opens their key for that session, their own Claude answers, and the open is audited as Google", async () => {
  const idp = createIdp({ issuer: ISSUER, clientId: CLIENT, secret: SECRET });
  const dir = seededDir();
  const reply = (a: { status?: number; json?: unknown; text?: string } | undefined) => {
    const body = a?.text ?? (a?.json === undefined ? "" : JSON.stringify(a.json));
    return { status: a?.status ?? (a === undefined ? 404 : 200), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: () => null as string | null } };
  };
  const d = await boot(dir, standIn, undefined, {
    vault: undefined,
    seams: { fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => reply(await idp.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body })) },
  } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    // the owner turns Google on with the client secret in the Vault, and makes an agent
    const folder = await ok(d, d.token, "vault.folders.create", { name: "Company connections", scope: "shared" });
    await ok(d, d.token, "vault.item.put", { folderId: folder.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SECRET, secret: true }] });
    await ok(d, d.token, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: DOMAIN } });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    // Rubab is invited at her work address and joins with her password (the one time she types it); her client hands the key over at the Space's door
    const rubab = await join(d, "rubab", EMAIL);
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    const ref = await connectClaude(d, rubab.token, "Rubab_Claude");
    await ok(d, rubab.token, "identity.sign_out", {});

    // later she signs in with Google
    const start = await fetch(`${d.url}/auth/sso/google/start?return=${encodeURIComponent(`${d.url}/app`)}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location")!);
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const back = await fetch(`${d.url}/auth/sso/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=${encodeURIComponent(idp.approve(to.toString(), { sub: "rubab-google-id", email: EMAIL, email_verified: true, hd: DOMAIN }))}`, { redirect: "manual", headers: { cookie } });
    assert.equal(back.status, 302);
    const fragment = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
    const signed = await api(d, null, "identity.sso_sign_in", { provider: "google", code: fragment.get("sso_code"), state: "-", deviceName: "Chrome", deviceClass: "web" });
    assert.equal(signed.status, 200, JSON.stringify(signed.data));
    const token = signed.data.session.token as string;

    // nothing typed: her key is open for this session, and her own Claude answers
    assert.deepEqual(await (await door(d, token, "status")).json(), { held: true, remembered: true, forgotten: false });
    assert.equal((await ask(d, agentId, { token }, "hello from rubab")).reply, `ran for ${rubab.personId} on subscription ${ref}`);
    const opened = ((await ok(d, d.token, "audit.list", { limit: 50 })).rows as Array<{ action: string; onBehalfOf?: { id: string }; after?: unknown }>).filter((r) => r.action === "vault.key_opened_after_sign_in");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.onBehalfOf?.id, rubab.personId);
    assert.match(JSON.stringify(opened[0]!.after), /"provider":"google"/);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
