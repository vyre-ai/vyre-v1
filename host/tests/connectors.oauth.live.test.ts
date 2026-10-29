// Generic OAuth on a booted daemon, over HTTP, with the real Vault, the real connector pipeline and the real Files source: the sign-in is completed as the person who started it, tokens live only in Vault
// items, an action runs with the token through the one-use fill, an expired token is refreshed (rotating the refresh token once), a locked vault refuses with guidance, and deleting revokes. The provider is
// a disposable transport port (the connector network seam), so no real account is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

test("OAuth connector: PKCE sign-in as the owner, tokens in the Vault, run, refresh, revoke on delete", async () => {
  const core = bootCore(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connectors-oauth-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE"); fs.copyFileSync(core.file, path.join(dir, "events.db")); core.close();
  // the provider: authorization-code with PKCE, bearer API, rotating refresh tokens, revoke
  const provider = { challenge: "", issued: 0, access: "", refresh: "", expired: new Set<string>(), seen: [] as string[], revoked: [] as string[], refreshes: 0, usedRefresh: new Set<string>() };
  const issue = () => { provider.issued++; provider.access = `at_ACCESS_${provider.issued}`; provider.refresh = `rt_REFRESH_${provider.issued}`; return { access_token: provider.access, refresh_token: provider.refresh, token_type: "Bearer", expires_in: 3600 }; };
  const reply = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) });
  const secretValues = ["client-secret-LIVE-VALUE", "code-LIVE-ONE"];
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "https://configured.fixture.test"], {}, "1.2.3"), platform: fakePlatform(),
    session: (headers) => ({ space: CORE_SPACE, principal: { kind: "person", id: headers.authorization === "Bearer owner" ? "usr_olivia" : "usr_noah" }, device: "fixture" }),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    connectorNetwork: {
      resolve: async () => ["203.0.113.9"],
      request: async (url, o) => {
        provider.seen.push(`${o.method} ${url.pathname}`);
        const form = new URLSearchParams(o.body ?? "");
        if (url.pathname === "/token") {
          assert.equal(form.get("client_secret"), secretValues[0], "the client secret reaches the app from the Vault slot");
          if (form.get("grant_type") === "authorization_code") {
            assert.equal(form.get("code"), secretValues[1]);
            assert.equal(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"), provider.challenge, "PKCE: the verifier answers the challenge");
            return reply(200, issue());
          }
          if (form.get("grant_type") === "refresh_token") {
            const token = form.get("refresh_token")!;
            if (token !== provider.refresh || provider.usedRefresh.has(token)) return reply(400, { error: "invalid_grant" });
            provider.usedRefresh.add(token); provider.refreshes++;
            return reply(200, issue());
          }
        }
        if (url.pathname === "/revoke") { provider.revoked.push(form.get("token") ?? ""); return reply(200, {}); }
        if (url.pathname === "/me") {
          const bearer = (o.headers["Authorization"] ?? "").replace(/^Bearer /, "");
          return bearer === provider.access && !provider.expired.has(bearer) ? reply(200, { user: { name: "Dana" } }) : reply(401, { error: "expired" });
        }
        return reply(404, {});
      },
    },
  });
  const call = async (token: string, cap: string, input: object): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  };
  const ok = async (token: string, cap: string, input: object): Promise<any> => { const r = await call(token, cap, input); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`); return r.body.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0; const key = (): string => `oauth-${++n}`;
  const keyRoute = (action: "unlock" | "lock") => fetch(`${d.url}/local/vault/key/${action}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer owner" }, body: action === "unlock" ? JSON.stringify({ key: Buffer.from(new Uint8Array(32).fill(9)).toString("base64") }) : undefined });
  try {
    assert.equal((await keyRoute("unlock")).status, 204);
    // the connector: made, its TOML source edited in Files, tested and published through the real path
    const init = await ok("owner", "connectors.init", { key: "livepay", title: "Live Pay", mode: "oauth_app", idempotencyKey: key() });
    const main = (await ok("owner", "files.list", { folder: init.folderId })).files.find((f: { name: string }) => f.name === "connector.toml");
    const toml = `key = "livepay"\ntitle = "Live Pay"\nmode = "oauth_app"\nscope = "person"\nversion = "0.0.0"\ndomains = ["api.livepay.test"]\nhealth = "me"\n\n[auth]\ntype = "oauth2"\nsecret = "Pay_Token"\nclientId = "live-client"\nclientSecret = "Pay_Client"\nauthUrl = "https://api.livepay.test/authorize"\ntokenUrl = "https://api.livepay.test/token"\nrevokeUrl = "https://api.livepay.test/revoke"\nscopes = ["read"]\n\n[[secrets]]\nname = "Pay_Token"\ndescription = "access token"\n\n[[secrets]]\nname = "Pay_Token_refresh"\ndescription = "refresh token"\n\n[[secrets]]\nname = "Pay_Client"\ndescription = "client secret"\n`;
    await ok("owner", "files.write", { fileId: main.fileId, baseVersion: main.version, content: { text: toml }, idempotencyKey: key() });
    const actions = (await ok("owner", "files.folder.create", { parentId: init.folderId, name: "actions", idempotencyKey: key() })).folder.folderId;
    await ok("owner", "files.create", { folderId: actions, name: "me.json", content: { text: JSON.stringify({ name: "me", url: "https://api.livepay.test/me", output: "/user" }) }, idempotencyKey: key() });
    const published = await ok("owner", "connectors.publish", { key: "livepay", idempotencyKey: key() });
    assert.equal(published.published, true, JSON.stringify(published));
    // a literal client secret in the source is refused before anything compiles
    await ok("owner", "files.write", { fileId: main.fileId, baseVersion: (await ok("owner", "files.get", { fileId: main.fileId })).file.version, content: { text: toml.replace('clientSecret = "Pay_Client"', `clientSecret = "${secretValues[0]}"`) }, idempotencyKey: key() });
    const literal = await call("owner", "connectors.test", { key: "livepay" });
    assert.ok(literal.status >= 400 && /clientSecret must name one of the declared secrets/.test(JSON.stringify(literal.body)), JSON.stringify(literal.body));
    await ok("owner", "files.write", { fileId: main.fileId, baseVersion: (await ok("owner", "files.get", { fileId: main.fileId })).file.version, content: { text: toml }, idempotencyKey: key() });

    // the client secret is a Vault item of the owner's; the connection names it by handle
    const mine = (await ok("owner", "vault.folders.create", { name: "Pay client", scope: "mine", idempotencyKey: key() })).folder.id;
    const client = (await ok("owner", "vault.item.put", { folderId: mine, name: "Pay Client Secret", kind: "api_key", fields: [{ key: "secret", value: secretValues[0], secret: true }], idempotencyKey: key() })).item;
    const connect = async (title: string) => ok("owner", "connections.create", { connector: "livepay", title, ownerKind: "person", secrets: { Pay_Client: client.handle }, idempotencyKey: key() });
    const made = await connect("Dana pay");
    const url = new URL(made.authUrl);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    provider.challenge = url.searchParams.get("code_challenge")!;
    const state = url.searchParams.get("state")!;

    // someone else cannot finish it (and cannot spend it); the provider is never contacted
    const seenBefore = provider.seen.length;
    const stolen = await call("member", "connections.complete_auth", { state, code: secretValues[1] });
    assert.equal(stolen.status, 403, JSON.stringify(stolen.body));
    assert.equal(provider.seen.length, seenBefore);
    // the owner finishes it
    const done = await ok("owner", "connections.complete_auth", { state, code: secretValues[1] });
    const connection = (await ok("owner", "connections.get", { connectionId: done.connectionId })).connection;
    assert.equal(connection.state, "active");
    assert.deepEqual(await call("owner", "connections.complete_auth", { state, code: secretValues[1] }).then((r) => r.status), 401, "a used state is refused");

    // tokens exist only as Vault items in the owner's Mine folder, and an action runs with the token through the real fill
    const folders = (await ok("owner", "vault.folders.list", { scope: "mine" })).folders as { id: string; name: string }[];
    const tokenFolder = folders.find((f) => f.name === "Connections");
    assert.ok(tokenFolder, "a Mine Connections folder holds the tokens");
    assert.equal((await ok("owner", "vault.folders.list", { scope: "shared" })).folders.some((f: { name: string }) => f.name === "Connections"), false, "nothing is Shared");
    const ran = await ok("owner", "connectors.run", { key: "livepay", action: "me", connectionId: done.connectionId, input: {}, idempotencyKey: key() });
    assert.deepEqual(ran.output, { name: "Dana" });

    // the access token expires at the app: the next run refreshes once, rotates the refresh token and succeeds
    provider.expired.add(provider.access);
    const refreshed = await ok("owner", "connectors.run", { key: "livepay", action: "me", connectionId: done.connectionId, input: {}, idempotencyKey: key() });
    assert.deepEqual(refreshed.output, { name: "Dana" });
    assert.equal(provider.refreshes, 1);
    assert.equal(provider.issued, 2);
    assert.equal((await ok("owner", "connections.get", { connectionId: done.connectionId })).connection.state, "active");

    // no token, code or client secret is in any log or table the daemon keeps
    d.sink.flush();
    const everything = JSON.stringify([d.sink.db.prepare("SELECT msg,attrs FROM logs").all()]);
    for (const v of [...secretValues, "at_ACCESS_1", "rt_REFRESH_1", "at_ACCESS_2", "rt_REFRESH_2"]) assert.equal(everything.includes(v), false, `${v} is not in the logs`);

    // a locked vault: a personal account's tokens are never put anywhere shared, so the sign-in is refused with guidance
    const second = await connect("Dana pay again");
    provider.challenge = new URL(second.authUrl).searchParams.get("code_challenge")!;
    assert.equal((await keyRoute("lock")).status, 204);
    const locked = await call("owner", "connections.complete_auth", { state: new URL(second.authUrl).searchParams.get("state")!, code: secretValues[1] });
    assert.ok(locked.status >= 400 && /vault is locked on this computer/.test(JSON.stringify(locked.body)), JSON.stringify(locked.body));
    assert.equal((await keyRoute("unlock")).status, 204);

    // deleting the connection revokes both tokens at the app and removes the Vault items
    await ok("owner", "connections.delete", { connectionId: done.connectionId });
    assert.deepEqual(provider.revoked.sort(), [provider.access, provider.refresh].sort());
    const left = ((await ok("owner", "vault.items.list", {})).items as { name: string }[]).map((i) => i.name);
    assert.deepEqual(left.filter((name) => /Pay_Token/.test(name)), [], "the token items are gone");
    assert.ok(left.includes("Pay Client Secret"), "the person's own client secret item is not touched");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
