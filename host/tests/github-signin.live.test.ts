// GitHub sign-in on a real booted daemon against a stand-in for github.com (a local http server with the authorize, token and user endpoints; never the real GitHub).
// Pattern from signin.policy.live.test.ts (claim, password sign-in, the policy capabilities); the people seam's createGithub is the one under test, pointed at the stand-in by its url options.
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
        const good = body.code !== undefined && issued.delete(body.code);   // a code works once
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

async function boot(dir: string, space: string, githubOAuth: Parameters<typeof startDaemon>[0]["githubOAuth"]) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", space, "--address", "gh.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "gh", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }),
    intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 3600000 },
    githubOAuth,
  });
}

test("GitHub sign-in: the Space says it is on, and start, callback and code exchange against a stand-in GitHub sign the linked person in", async () => {
  const gh = await standIn();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gh-signin-"));
  const d = await boot(dir, "spc_gh", { clientId: "stub-client", clientSecret: "stub-secret", authorizeUrl: `${gh.url}/authorize`, tokenUrl: `${gh.url}/token`, userUrl: `${gh.url}/user` });
  const post = async (cap: string, input: unknown, token?: string) => { const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) }); return { status: r.status, body: await r.json() as { data?: any; error?: { code: string } } }; };
  /** the browser leg: start, the stand-in's authorize, the callback with the cookie; resolves to the code the app gets in the fragment */
  const browserLeg = async (ret: string): Promise<{ code: string | null; location: string }> => {
    const start = await fetch(`${d.url}/auth/github/start?return=${encodeURIComponent(ret)}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0]!;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    assert.equal(authorize.status, 302);
    const back = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie } });
    assert.equal(back.status, 302);
    const location = back.headers.get("location")!;
    return { code: new URLSearchParams(new URL(location).hash.slice(1)).get("github_code"), location };
  };
  try {
    const claimCode = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    assert.equal((await post("identity.claim_owner", { code: claimCode, spaceId: "spc_gh", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const token = (await post("identity.sign_in", { username: "olivia", password: PASSWORD, ...device })).body.data.session.token as string;

    // (a) what the sign-in page is told: GitHub on, from the configured OAuth app and the saved policy; SSO still off
    const opts = (await post("identity.sign_in_options", {})).body.data;
    assert.equal(opts.github, true); assert.deepEqual(opts.sso, []); assert.equal(opts.password, true);
    assert.ok(!JSON.stringify(opts).includes("stub-secret"), "the options never carry the OAuth secret");
    assert.equal((await post("members.sign_in_policy.get", {}, token)).body.data.capabilities.github, true);
    assert.equal((await post("identity.sso_sign_in", { provider: "google", code: "x", state: "y", ...device })).body.error?.code, "validation.unsupported");

    // not linked yet: a person GitHub knows but this Space does not is refused
    const appPage = `${d.url}/`;
    const first = await browserLeg(appPage);
    assert.ok(first.location.startsWith(appPage), "returns to the app page"); assert.ok(first.code?.startsWith("stub-code-"));
    assert.equal((await post("identity.github_sign_in", { code: first.code, ...device })).body.error?.code, "auth.bad_credentials");

    // link GitHub to the owner (the same stand-in resolves the code), then (c) the full flow signs her in
    const linkLeg = await browserLeg(appPage);
    assert.equal((await post("identity.github_link", { code: linkLeg.code }, token)).body.data.login, "olivia-gh");
    const leg = await browserLeg(appPage);
    const signed = await post("identity.github_sign_in", { code: leg.code, ...device });
    assert.equal(signed.status, 200); assert.equal(signed.body.data.status, "ok");
    const gtoken = signed.body.data.session.token as string;
    assert.notEqual(gtoken, token);
    assert.equal((await post("identity.whoami", {}, gtoken)).status, 200);
    assert.equal((await post("identity.github_sign_in", { code: leg.code, ...device })).status, 401, "a code works once");

    // what the stand-in saw: the app's id and secret went to the token endpoint, the token to the user endpoint, never the other way
    assert.ok(gh.seen.tokens.every((t) => t.client_id === "stub-client" && t.client_secret === "stub-secret"));
    assert.ok(gh.seen.authorize.every((q) => q.get("client_id") === "stub-client" && q.get("redirect_uri") === `${d.url}/auth/github/callback` && !q.has("client_secret")));
    assert.ok(gh.seen.users.every((a) => a === "Bearer stub-token"));

    // the browser leg refuses what it should
    assert.equal((await fetch(`${d.url}/auth/github/start?return=${encodeURIComponent("https://evil.example/")}`, { redirect: "manual" })).status, 400, "a stranger's site is not a return address");
    assert.equal((await fetch(`${d.url}/auth/github/callback?code=stolen&state=nope`, { redirect: "manual" })).status, 400, "a callback with no matching state is refused");
    const start = await fetch(`${d.url}/auth/github/start?return=${encodeURIComponent(appPage)}`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    assert.equal((await fetch(`${d.url}/auth/github/callback?code=c&state=${state}`, { redirect: "manual" })).status, 400, "a callback from a browser that did not start it (no cookie) is refused");

    // the owner turning GitHub off in the sign-in policy turns the button and the door off
    const policy = (await post("members.sign_in_policy.get", {}, token)).body.data.policy;
    assert.equal((await post("members.sign_in_policy.set", { policy: { ...policy, allowGithub: false } }, token)).status, 200);
    assert.equal((await post("identity.sign_in_options", {})).body.data.github, false);
    const off = await browserLeg(appPage);
    assert.equal((await post("identity.github_sign_in", { code: off.code, ...device })).body.error?.code, "auth.bad_credentials");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); await gh.close(); }
});

test("GitHub sign-in: without an OAuth app on the server the Space says GitHub is off and the start route says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gh-off-"));
  const d = await boot(dir, "spc_gh_off", null);
  try {
    const r = await fetch(`${d.url}/v1/identity/sign_in_options`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(((await r.json()) as { data: { github: boolean } }).data.github, false);
    assert.equal((await fetch(`${d.url}/auth/github/start?return=${encodeURIComponent(d.url + "/")}`, { redirect: "manual" })).status, 503);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
