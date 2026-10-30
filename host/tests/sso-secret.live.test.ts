// The setup secrets are for Owner and Admin alone: the SSO client secrets for Google and Microsoft (Console > Policies > Sign-in, sso-save.ts), the GitHub sign-in client secret (members.sign_in_github.set),
// the Google Workspace service-account key (Google_DWD) and the Microsoft 365 app secret (Microsoft_App), the last two filed by the setup pages' own code (suite/flow.ts storeInVault). Each lands in a
// Restricted folder as a Restricted item. On a booted daemon the owner files and sees all five; a Member cannot list the folder or an item, search for it, get, reveal, use, read the history of, change
// or delete any of them, and cannot read or set the SSO setup; an agent has no level on any of them, not even Use, alone or acting for the owner; no reply or file in the clear holds a secret.
// (Without the Restricted label every Member held Edit on a shared Vault folder through their role, and could list, use and overwrite the items: a Member could replace a key that reads every mailbox.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { saveSso } from "../../apps/app/src/console/pages/sso-save.ts";
import { storeInVault } from "../../apps/app/src/console/pages/suite/flow.ts";
const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const device = { deviceName: "SSO test", deviceClass: "desktop" };
const SECRET = "GOCSPX-sso-client-secret-0123456789abcdef";
const MS_SECRET = "msft~sso-client-secret-0123456789abcdef";
const GH_SECRET = "sekrit-gh-client-secret-0123456789abcdef";
const DWD_KEY = JSON.stringify({ type: "service_account", client_id: "1122334455", client_email: "dwd@firm.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvQ-dwd-private-key-0123456789\\n-----END PRIVATE KEY-----\\n" });
const MS_APP = JSON.stringify({ clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "msapp~app-client-secret-0123456789abcdef", tenantId: "0f6c0b1e-3c1a-4a52-9a57-6a1f2f2f0a11" });
const CLEAR = [SECRET, MS_SECRET, GH_SECRET, "MIIEvQ-dwd-private-key-0123456789", "msapp~app-client-secret-0123456789abcdef"];
const everything = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? everything(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test("the setup secrets (SSO Google and Microsoft, GitHub sign-in, Google DWD key, Microsoft 365 app): the owner files each as its page does; a Member and an agent can neither list, read, reveal, use, change nor delete any", async () => {
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

    // the other four setup secrets, each filed by its own page's code or capability
    assert.equal((await saveSso(callAs(owner), { key: "microsoft", clientId: "11111111-2222-3333-4444-555555555555", secret: MS_SECRET, domain: "firm.com", tenant: "0F6C0B1E-3C1A-4A52-9A57-6A1F2F2F0A11", enabled: true }, undefined)).ok, true);
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0001", clientSecret: GH_SECRET }, owner)).status, 200);
    const run = async (cap: string, input: unknown): Promise<any> => { const body = input && typeof input === "object" && (input as { idempotencyKey?: string }).idempotencyKey === "" ? { ...input, idempotencyKey: `run-${cap}-${Math.random().toString(36).slice(2)}` } : input;   // the Console's runner fills the key in
    const r = await seen(cap, body, owner); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`); return r.body.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const folderView = async () => (await run("vault.folders.list", { scope: "shared" })).folders as { id: string; name: string; yourLevel: string }[];
    assert.equal(await storeInVault(run, { name: "Google_DWD", handle: "#Google_DWD", text: DWD_KEY, folders: await folderView() }), true);
    assert.equal(await storeInVault(run, { name: "Microsoft_App", handle: "#Microsoft_App", text: MS_APP, folders: await folderView() }), true);
    const NAMES = ["Sso_Google_Secret", "Sso_Microsoft_Secret", "GitHub sign-in client secret", "Google_DWD", "Microsoft_App"];
    const all = (await post("vault.items.list", {}, owner)).body.data.items as { id: string; name: string; handle: string; folderId: string }[];
    const secrets = NAMES.map((n) => all.find((i) => i.name === n)!);
    assert.ok(secrets.every(Boolean), `the owner sees all five: ${all.map((i) => i.name).join(", ")}`);
    const folderIds = [...new Set(secrets.map((i) => i.folderId))];
    const keepMemberOut = async (): Promise<void> => {
      // a Member: no folder, no item in any list or search, and every way in is refused
      const mFolders = (await seen("vault.folders.list", { scope: "shared" }, member)).body.data.folders as { id: string }[];
      for (const id of folderIds) assert.ok(!mFolders.some((f) => f.id === id), "no secret folder is listed for a Member");
      for (const section of ["space", "shared", "personal"] as const) { const l = (await seen("vault.items.list", { section }, member)).body.data.items as { name: string }[]; for (const n of NAMES) assert.ok(!l.some((i) => i.name === n), `${n} is not in the ${section} list`); }
      for (const n of NAMES) assert.equal(((await seen("vault.items.list", { q: n }, member)).body.data.items as unknown[]).length, 0, `a search does not find ${n}`);
      for (const it of secrets) for (const [cap, input] of [
        ["vault.item.get", { itemId: it.id }], ["vault.item.reveal", { itemId: it.id }], ["vault.item.history", { itemId: it.id }], ["vault.use", { item: it.name }],
        ["vault.item.update", { itemId: it.id, fieldsSet: [{ key: "key", value: "member-was-here-0123456789", secret: true }], idempotencyKey: `m-upd-${it.id}` }], ["vault.item.delete", { itemId: it.id, idempotencyKey: `m-del-${it.id}` }],
      ] as const) { const r = await seen(cap, input, member); assert.ok(refused(r), `${cap} on ${it.name} as a Member answered ${r.status}`); }
      for (const [cap, input] of [
        ["members.sso.list", {}], ["members.sso.test", { key: "google" }], ["members.sso.remove", { key: "google" }], ["members.sign_in_github.get", {}], ["members.sign_in_github.clear", {}],
        ["members.sso.set", { provider: { key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "x", clientSecretHandle: item.handle, enabled: true, domainHint: "firm.com" } }],
      ] as const) { const r = await seen(cap, input, member); assert.ok(refused(r), `${cap} as a Member answered ${r.status}`); }
    };
    await keepMemberOut();
    assert.ok(((await post("members.sso.list", {}, owner)).body.data.providers as unknown[]).length === 2, "nothing a Member tried changed the setup");
    for (const it of secrets) assert.equal((await post("vault.item.get", { itemId: it.id }, owner)).status, 200, `the owner can still get ${it.name}`);
    assert.equal(((await post("members.sign_in_github.get", {}, owner)).body.data.github as { secretSet: boolean }).secretSet, true);

    // an agent, alone or acting for the owner, and the Member too, hold no level on any item or folder, not even Use
    const targets = [...secrets.map((i) => ({ type: "vault_item", id: i.id })), ...folderIds.map((id) => ({ type: "vault_folder", id }))];
    for (const resource of targets) for (const level of ["use", "view", "edit", "manage"] as const) {
      for (const who of [{ principal: { kind: "agent", id: agent } }, { principal: { kind: "agent", id: agent }, actingFor: { kind: "person", id: ownerId } }, { principal: { kind: "person", id: memberId } }]) {
        const c = await seen("access.check", { ...who, action: { level }, resource }, owner);
        assert.equal(c.body.data.decision.effect, "deny", `${JSON.stringify(who)} at ${level} on ${resource.type} ${resource.id}`);
      }
    }

    // saving each again keeps it restricted: the Member is still out
    assert.equal(await storeInVault(run, { name: "Google_DWD", handle: "#Google_DWD", text: `${DWD_KEY} `, folders: await folderView(), existingItemId: secrets[3]!.id }), true);
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0002", clientSecret: GH_SECRET }, owner)).status, 200);
    await keepMemberOut();

    // no secret is in a reply or in a file in the clear
    for (const c of CLEAR) assert.ok(replies.every((r) => !r.includes(c)), `no reply carries ${c.slice(0, 8)}...`);
    for (const file of everything(dir)) for (const c of CLEAR) assert.ok(!fs.readFileSync(file).includes(c), `${path.relative(dir, file)} holds a secret in the clear`);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
