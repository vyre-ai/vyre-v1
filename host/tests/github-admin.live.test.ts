// An admin turns GitHub sign-in on from the app: client id and secret through members.sign_in_github.set, the secret filed in the Vault, then the full sign-in against a stand-in for github.com (never the real GitHub).
// Pattern from github-signin.live.test.ts (the stand-in, the browser leg) and actor.credential.live.test.ts (inviting a Member).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const device = { deviceName: "GitHub test", deviceClass: "desktop" };
const SECRET = "sekrit-gh-client-secret-0123456789abcdef";

/** Stand-in for github.com: /authorize bounces to redirect_uri with a code, /token trades the code, /user says who. Records what it was asked. */
async function standIn(): Promise<{ url: string; seen: { authorize: URLSearchParams[]; tokens: { client_id?: string; client_secret?: string; code?: string }[]; users: string[] }; close(): Promise<void> }> {
  const seen = { authorize: [] as URLSearchParams[], tokens: [] as { client_id?: string; client_secret?: string; code?: string }[], users: [] as string[] };
  const issued = new Set<string>();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://stub");
    if (u.pathname === "/authorize") {
      seen.authorize.push(u.searchParams);
      const code = `stub-code-${issued.size + 1}`; issued.add(code);
      res.writeHead(302, { location: `${u.searchParams.get("redirect_uri")}?code=${code}&state=${u.searchParams.get("state")}` }); res.end(); return;
    }
    if (u.pathname === "/token" && req.method === "POST") {
      let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => {
        const body = JSON.parse(b) as { client_id?: string; client_secret?: string; code?: string }; seen.tokens.push(body);
        const good = body.code !== undefined && body.client_secret === "sekrit-gh-client-secret-0123456789abcdef" && issued.delete(body.code);   // a code works once
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(good ? { access_token: "stub-token" } : { error: "bad_verification_code" }));
      }); return;
    }
    if (u.pathname === "/user") {
      seen.users.push(String(req.headers.authorization));
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(req.headers.authorization === "Bearer stub-token" ? { id: 4242, login: "olivia-gh" } : {})); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, seen, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

async function boot(dir: string, space: string, githubEndpoints: Parameters<typeof startDaemon>[0]["githubEndpoints"]) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", space, "--address", "gh.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "gh", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }),
    intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 3600000 },
    githubOAuth: null, githubEndpoints,
  });
}


const everything = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? everything(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test("an admin sets the GitHub app in the app: the secret goes to the Vault and is never shown, the Space offers GitHub, and the flow completes", async () => {
  const gh = await standIn();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gh-admin-"));
  delete process.env["VYRE_GH_OAUTH_CLIENT_ID"]; delete process.env["VYRE_GH_OAUTH_CLIENT_SECRET"];
  const d = await boot(dir, "spc_gh_admin", { authorizeUrl: `${gh.url}/authorize`, tokenUrl: `${gh.url}/token`, userUrl: `${gh.url}/user` });
  const post = async (cap: string, input: unknown, token?: string) => { const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) }); return { status: r.status, text: "", body: await r.json() as { data?: any; error?: { code: string } } }; };
  const leg = async (): Promise<string> => {
    const start = await fetch(`${d.url}/auth/github/start?return=${encodeURIComponent(`${d.url}/`)}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0]!;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const back = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie } });
    return new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1)).get("github_code")!;
  };
  const replies: string[] = [];
  const seen = async (cap: string, input: unknown, token?: string) => { const r = await post(cap, input, token); replies.push(JSON.stringify(r.body)); return r; };
  try {
    const claimCode = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    assert.equal((await post("identity.claim_owner", { code: claimCode, spaceId: "spc_gh_admin", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const owner = (await post("identity.sign_in", { username: "olivia", password: PASSWORD, ...device })).body.data.session.token as string;
    // a Member joins; she can read nothing of this and set nothing
    const roles = (await post("access.roles.list", {}, owner)).body.data.roles as { id: string; name: string }[];
    const invite = await post("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "gh-admin-inv" }, owner);
    const code = decodeURIComponent(new URL(invite.body.data.link).pathname.split("/").pop() ?? "");
    assert.equal((await post("members.accept", { code, username: "pia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const member = (await post("identity.sign_in", { username: "pia", password: PASSWORD, ...device })).body.data.session.token as string;

    // before: GitHub is off, and the page can say what to register at GitHub
    assert.equal((await post("identity.sign_in_options", {})).body.data.github, false);
    const before = (await seen("members.sign_in_github.get", {}, owner)).body.data.github;
    assert.equal(before.source, "none"); assert.equal(before.secretSet, false); assert.equal(before.callbackUrl, "https://gh.example.com/auth/github/callback");
    const create = new URL(before.createUrl); assert.equal(create.origin + create.pathname, "https://github.com/settings/applications/new");
    assert.equal(create.searchParams.get("oauth_application[callback_url]"), before.callbackUrl); assert.equal(create.searchParams.get("oauth_application[url]"), "https://gh.example.com");

    // a Member cannot read or change it, and nothing changes
    for (const [cap, input] of [["members.sign_in_github.get", {}], ["members.sign_in_github.set", { clientId: "Iv1.stubclient0001", clientSecret: SECRET }], ["members.sign_in_github.clear", {}]] as const) assert.equal((await seen(cap, input, member)).status, 403, cap);
    assert.equal((await post("identity.sign_in_options", {})).body.data.github, false);
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0001", clientSecret: SECRET })).status, 401, "nobody signed in cannot set it");

    // the admin sets it; a bad secret or id is refused
    assert.equal((await seen("members.sign_in_github.set", { clientId: "x", clientSecret: SECRET }, owner)).body.error?.code, "validation.bad_input");
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0001" }, owner)).body.error?.code, "validation.bad_input", "the first save needs the secret");
    const saved = await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0001", clientSecret: SECRET }, owner);
    assert.equal(saved.status, 200); assert.deepEqual({ ...saved.body.data.github, callbackUrl: "", createUrl: "" }, { clientId: "Iv1.stubclient0001", secretSet: true, source: "space", callbackUrl: "", createUrl: "" });

    // (a) the Space now says GitHub is on, and the policy page agrees
    assert.equal((await post("identity.sign_in_options", {})).body.data.github, true);
    assert.equal((await post("members.sign_in_policy.get", {}, owner)).body.data.capabilities.github, true);
    // the secret is a Space item in the Vault, found by handle, and nothing but the Vault holds it
    const items = (await post("vault.items.list", { q: "GitHub sign-in" }, owner)).body.data.items as { name: string; scope: string; handle: string; fieldKeys: string[] }[];
    assert.ok(items.some((i) => i.name === "GitHub sign-in client secret" && i.scope === "shared" && i.fieldKeys.includes("client_secret")));
    assert.equal((await seen("members.sign_in_github.get", {}, owner)).body.data.github.secretSet, true);

    // (c) the full flow with the secret read back from the Vault: link, then sign in
    const link = await post("identity.github_link", { code: await leg() }, owner);
    assert.equal(link.body.data.login, "olivia-gh");
    const signed = await post("identity.github_sign_in", { code: await leg(), ...device });
    assert.equal(signed.status, 200, JSON.stringify(signed.body)); assert.equal((await post("identity.whoami", {}, signed.body.data.session.token)).status, 200);
    assert.ok(gh.seen.tokens.length >= 2 && gh.seen.tokens.every((t) => t.client_id === "Iv1.stubclient0001" && t.client_secret === SECRET), "GitHub got the id and the Vault's secret");

    // changing only the id keeps the saved secret; a second save of the secret updates the one Vault item
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0002" }, owner)).body.data.github.clientId, "Iv1.stubclient0002");
    assert.equal((await seen("members.sign_in_github.set", { clientId: "Iv1.stubclient0002", clientSecret: SECRET }, owner)).status, 200);
    assert.equal(((await post("vault.items.list", { q: "GitHub sign-in" }, owner)).body.data.items as { name: string }[]).filter((i) => i.name === "GitHub sign-in client secret").length, 1);

    // the secret is in no reply, no audit row and no file on disk (the Vault file holds it sealed)
    const audit = await post("audit.list", { target: { kind: "policy", id: "sign_in" }, limit: 50 }, owner);
    replies.push(JSON.stringify(audit.body));
    assert.ok(replies.every((r) => !r.includes(SECRET)), "no reply carries the secret");
    for (const file of everything(dir)) assert.ok(!fs.readFileSync(file).includes(SECRET), `${path.relative(dir, file)} holds the secret in the clear`);

    // forgetting the app turns GitHub off again
    assert.equal((await seen("members.sign_in_github.clear", {}, member)).status, 403);
    assert.equal((await seen("members.sign_in_github.clear", {}, owner)).body.data.github.source, "none");
    assert.equal((await post("identity.sign_in_options", {})).body.data.github, false);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); await gh.close(); }
});
