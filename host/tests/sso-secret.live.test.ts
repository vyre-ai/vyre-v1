// The SSO client secret is for Owner and Admin alone (Console > Policies > Sign-in). The form files it with the real code (sso-save.ts): a Space-only Vault item in a Restricted folder, and only its
// handle in members.sso.set. On a booted daemon the owner files it and sees it; a Member cannot list the folder or the item, search for it, get, reveal, use, read the history of, change or delete it,
// and cannot read or set the SSO setup; an agent has no level on it at all, not even Use, alone or acting for the owner; no reply or file in the clear holds the secret.
// (Without the Restricted label every Member held Edit on a shared Vault folder through their role, and could list, use and overwrite the item.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { saveSso } from "../../apps/app/src/console/pages/sso-save.ts";
const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const device = { deviceName: "SSO test", deviceClass: "desktop" };
const SECRET = "GOCSPX-sso-client-secret-0123456789abcdef";
const everything = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? everything(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test("the SSO client secret: the owner files it as the form does; a Member and an agent can neither list, read, reveal, use, change nor delete it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sso-secret-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_sso_secret", "--address", "sso.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "sso", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }),
    intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 3600000 },
    githubOAuth: null,
  });
  const post = async (cap: string, input: unknown, token?: string) => { const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) }); return { status: r.status, body: (await r.json()) as any }; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const replies: string[] = [];
  const seen = async (cap: string, input: unknown, token?: string) => { const r = await post(cap, input, token); replies.push(JSON.stringify(r.body)); return r; };
  const refused = (r: { status: number }): boolean => r.status === 403 || r.status === 404;
  try {
    const claimCode = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const claim = await post("identity.claim_owner", { code: claimCode, spaceId: "spc_sso_secret", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const owner = (await post("identity.sign_in", { username: "olivia", password: PASSWORD, ...device })).body.data.session.token as string;
    const roles = (await post("access.roles.list", {}, owner)).body.data.roles as { id: string; name: string }[];
    const invite = await post("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "sso-sec-inv" }, owner);
    const code = decodeURIComponent(new URL(invite.body.data.link).pathname.split("/").pop() ?? "");
    assert.equal((await post("members.accept", { code, username: "pia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const member = (await post("identity.sign_in", { username: "pia", password: PASSWORD, ...device })).body.data.session.token as string;
    const memberId = (await post("identity.whoami", {}, member)).body.data.principal.id as string;
    const ownerId = (await post("identity.whoami", {}, owner)).body.data.principal.id as string;
    const agent = (await seen("agents.create", { name: "Helper", role: "You help.", idempotencyKey: "sso-sec-agent" }, owner)).body.data.agent.agentId as string;

    // the owner saves Google through the form's own code
    const callAs = (token: string) => async (cap: string, input: unknown): Promise<unknown> => { const r = await seen(cap, input, token); if (r.status !== 200) throw Object.assign(new Error(r.body.error?.message ?? "failed"), { code: r.body.error?.code }); return r.body.data; };
    const saved = await saveSso(callAs(owner), { key: "google", clientId: "1234-abc.apps.googleusercontent.com", secret: SECRET, domain: "firm.com", tenant: "", enabled: true }, undefined);
    assert.deepEqual(saved, { ok: true, message: "Google sign-in saved" });
    const items = (await post("vault.items.list", { q: "Sso_Google" }, owner)).body.data.items as { id: string; handle: string; folderId: string; scope: string; spaceOnly: boolean }[];
    assert.equal(items.length, 1, "the owner sees it");
    const item = items[0]!;
    assert.equal(item.scope, "shared"); assert.equal(item.spaceOnly, true);
    const provider = ((await post("members.sso.list", {}, owner)).body.data.providers as { clientSecretHandle: string }[])[0]!;
    assert.equal(provider.clientSecretHandle, item.handle, "only the handle is kept in the policy");
    assert.equal((await post("vault.item.get", { itemId: item.id }, owner)).status, 200, "the owner can still get it");
    // saving again with a new secret updates the same item and keeps it restricted
    assert.equal((await saveSso(callAs(owner), { key: "google", clientId: "1234-abc.apps.googleusercontent.com", secret: `${SECRET}-rotated`, domain: "firm.com", tenant: "", enabled: true }, provider as never)).ok, true);
    assert.equal(((await post("vault.items.list", { q: "Sso_Google" }, owner)).body.data.items as unknown[]).length, 1);

    // a Member: no folder, no item in any list or search, and every way in is refused
    const mFolders = (await seen("vault.folders.list", { scope: "shared" }, member)).body.data.folders as { id: string }[];
    assert.ok(!mFolders.some((f) => f.id === item.folderId), "the folder is not listed for a Member");
    for (const section of ["space", "shared", "personal"] as const) assert.ok(!((await seen("vault.items.list", { section }, member)).body.data.items as { id: string }[]).some((i) => i.id === item.id), `not in the ${section} list`);
    assert.equal(((await seen("vault.items.list", { q: "Sso_Google" }, member)).body.data.items as unknown[]).length, 0, "a search does not find it");
    for (const [cap, input] of [
      ["vault.item.get", { itemId: item.id }], ["vault.item.reveal", { itemId: item.id }], ["vault.item.history", { itemId: item.id }], ["vault.use", { item: "Sso_Google_Secret" }],
      ["vault.item.update", { itemId: item.id, fieldsSet: [{ key: "client_secret", value: "member-was-here-0123456789", secret: true }], idempotencyKey: "m-upd" }], ["vault.item.delete", { itemId: item.id, idempotencyKey: "m-del" }],
      ["members.sso.list", {}], ["members.sso.test", { key: "google" }], ["members.sso.remove", { key: "google" }],
      ["members.sso.set", { provider: { key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "x", clientSecretHandle: item.handle, enabled: true, domainHint: "firm.com" } }],
    ] as const) { const r = await seen(cap, input, member); assert.ok(refused(r), `${cap} as a Member answered ${r.status}`); }
    assert.ok(((await post("members.sso.list", {}, owner)).body.data.providers as unknown[]).length === 1, "nothing a Member tried changed the setup");

    // an agent, alone or acting for the owner, and the Member too, hold no level on the item or its folder, not even Use
    for (const resource of [{ type: "vault_item", id: item.id }, { type: "vault_folder", id: item.folderId }]) for (const level of ["use", "view", "edit", "manage"] as const) {
      for (const who of [{ principal: { kind: "agent", id: agent } }, { principal: { kind: "agent", id: agent }, actingFor: { kind: "person", id: ownerId } }, { principal: { kind: "person", id: memberId } }]) {
        const c = await seen("access.check", { ...who, action: { level }, resource }, owner);
        assert.equal(c.body.data.decision.effect, "deny", `${JSON.stringify(who)} at ${level} on ${resource.type}`);
      }
    }

    // the secret is in no reply and no file in the clear
    assert.ok(replies.every((r) => !r.includes(SECRET)), "no reply carries the secret");
    for (const file of everything(dir)) assert.ok(!fs.readFileSync(file).includes(SECRET), `${path.relative(dir, file)} holds the secret in the clear`);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
