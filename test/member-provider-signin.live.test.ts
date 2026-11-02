// A member who signs in with GitHub (or Google: the same identity path, issueSession after the provider's proof) types nothing and their own AI account still works (owner ruling 3 Nov, R62 amended),
// on a booted server-role daemon with a stand-in for github.com. They typed their password once, at join, and their client handed the key over: the server sealed a copy under its own secret. A later
// GitHub sign-in opens it into the new session only, with an audit row (who, when, which provider). "Forget on this server" deletes it and stops new ones; an owner turning the policy off in the
// Console drops every one. The person key is in no file of the data directory in the clear.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, ask, connectClaude, door, filesHolding, join, ok, standIn } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const GH_ID = 4242;
/** Stand-in for github.com: /authorize answers a one-use code, /token trades it, /user says who (always the same GitHub account). */
async function github(): Promise<{ url: string; code(): Promise<string>; close(): Promise<void> }> {
  const issued = new Set<string>();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://stub");
    if (u.pathname === "/authorize") { const c = `gh-code-${issued.size + 1}-${Date.now()}`; issued.add(c); res.writeHead(200, { "content-type": "text/plain" }); res.end(c); return; }
    if (u.pathname === "/token" && req.method === "POST") {
      let b = ""; req.on("data", (x) => { b += x; }); req.on("end", () => {
        const code = (JSON.parse(b) as { code?: string }).code;
        const good = code !== undefined && issued.delete(code);
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(good ? { access_token: "stub-token" } : { error: "bad_verification_code" }));
      }); return;
    }
    if (u.pathname === "/user") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(req.headers.authorization === "Bearer stub-token" ? { id: GH_ID, login: "rubab-gh" } : {})); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, code: async () => (await fetch(`${url}/authorize`)).text(), close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const held = async (d: Daemon, token: string): Promise<{ held: boolean; remembered: boolean; forgotten: boolean }> => (await (await door(d, token, "status")).json()) as { held: boolean; remembered: boolean; forgotten: boolean };

test("Team server: a member who signs in with GitHub types nothing and their own Claude answers; the open is audited; Forget and the owner's switch end it", async () => {
  const gh = await github();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, {
    vault: undefined, githubOAuth: { clientId: "stub-client", clientSecret: "stub-secret", authorizeUrl: `${gh.url}/authorize`, tokenUrl: `${gh.url}/token`, userUrl: `${gh.url}/user` },
  } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  const signInWithGithub = async (): Promise<string> => {
    const r = await api(d, null, "identity.github_sign_in", { code: await gh.code(), deviceName: "Chrome", deviceClass: "web" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.session.token as string;
  };
  try {
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
    // Rubab joins with her password (the only time she types it); her client hands the key over at the Space's door, and the server keeps a sealed copy
    const rubab = await join(d, "rubab");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    assert.deepEqual(await held(d, rubab.token), { held: true, remembered: true, forgotten: false });
    const ref = await connectClaude(d, rubab.token, "Rubab_Claude");
    assert.equal((await ok(d, rubab.token, "identity.github_link", { code: await gh.code() })).login, "rubab-gh");
    await ok(d, rubab.token, "identity.sign_out", {});

    // later, from a browser, she signs in with GitHub: nothing to type, her Vault is open for this session and her own Claude answers
    const t2 = await signInWithGithub();
    assert.equal((await held(d, t2)).held, true, "the wrap opened into this session");
    assert.equal((await ask(d, agentId, { token: t2 }, "hello from rubab")).reply, `ran for ${rubab.personId} on subscription ${ref}`);
    // the open is in the audit log: who, when, which provider
    const audit = (await ok(d, d.token, "audit.list", { limit: 50 })).rows as Array<{ action: string; at: number; onBehalfOf?: { id: string }; after?: unknown }>;
    const opened = audit.filter((r) => r.action === "vault.key_opened_after_sign_in");
    assert.equal(opened.length, 1, JSON.stringify(audit.map((r) => r.action)));
    assert.equal(opened[0]!.onBehalfOf?.id, rubab.personId);
    assert.match(JSON.stringify(opened[0]!.after), /"provider":"github"/);

    // Forget on this server: the copy is gone, and a GitHub sign-in opens nothing (she types her password to open it)
    assert.equal((await door(d, t2, "forget")).status, 204);
    assert.deepEqual(await held(d, t2), { held: true, remembered: false, forgotten: true }, "this session keeps what it has");
    await ok(d, t2, "identity.sign_out", {});
    const t3 = await signInWithGithub();
    assert.equal((await held(d, t3)).held, false, "forgotten: nothing opens after GitHub");
    // a password unlock while she has said Forget keeps no copy either
    assert.equal((await door(d, t3, "unlock", rubab.personKey)).status, 204);
    assert.deepEqual(await held(d, t3), { held: true, remembered: false, forgotten: true });
    // she takes it back; the next password unlock keeps one again
    assert.equal((await door(d, t3, "remember")).status, 204);
    assert.equal((await door(d, t3, "unlock", rubab.personKey)).status, 204);
    assert.equal((await held(d, t3)).remembered, true);

    // the owner turns "Members' AI sign-ins open after Google or GitHub sign-in" off: every copy goes, and GitHub opens nothing
    await ok(d, d.token, "access.policies.set", { key: "vault.open_after_provider_sign_in", scope: "space", value: false });
    await ok(d, t3, "identity.sign_out", {});
    const t4 = await signInWithGithub();
    assert.equal((await held(d, t4)).held, false, "off: nothing opens after GitHub");
    const rows = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    assert.equal((rows.prepare("SELECT count(*) AS n FROM host_person_wrap").get() as { n: number }).n, 0, "every wrap was dropped");
    rows.close();
    assert.equal((await door(d, t4, "unlock", rubab.personKey)).status, 204, "her password still opens it for the session");
    assert.equal((await held(d, t4)).remembered, false, "and no copy is kept while the switch is off");

    // the wrap's secret is a file beside the Vault's own key, never in the database; the person key is in no file in the clear
    assert.ok(fs.existsSync(path.join(dir, "person-wrap.key")));
    const secret = fs.readFileSync(path.join(dir, "person-wrap.key"), "utf8").trim();
    assert.deepEqual(filesHolding(dir, Buffer.from(secret)).filter((f) => f !== "person-wrap.key"), [], "the wrap secret is only in its own file");
    for (const needle of [Buffer.from(rubab.personKey), Buffer.from(Buffer.from(rubab.personKey).toString("base64")), Buffer.from(Buffer.from(rubab.personKey).toString("base64url"))]) assert.deepEqual(filesHolding(dir, needle), [], "no person key in the clear");
  } finally {
    await d.stop();
    await gh.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
