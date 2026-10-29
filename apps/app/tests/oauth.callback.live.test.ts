// The OAuth callback page in Chromium against the production export and a booted daemon (real connector pipeline, Vault and Files source; the OAuth provider is a disposable transport port). It proves the
// page finishes a sign-in as the signed-in person who started it, takes the code and state out of the address, and tells every other outcome in words: declined, expired, used, someone else's, signed out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootCore, CORE_SPACE } from "../../../fixtures/seed/core/index.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import { CLIENT_SECRET, PAY_ACTION, PAY_TOML, oauthProvider } from "../../../fixtures/oauth-provider.ts";
import { edge } from "./real-app-harness.test.ts";

test("the OAuth callback page finishes a connection as its owner and tells every other outcome in words", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const core = bootCore(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-oauth-callback-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE"); fs.copyFileSync(core.file, path.join(dir, "events.db")); core.close();
  const provider = oauthProvider();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "https://configured.fixture.test"], {}, "1.2.3"), platform: fakePlatform(),
    session: (headers) => ({ space: CORE_SPACE, principal: { kind: "person", id: headers.authorization === "Bearer owner" ? "usr_olivia" : "usr_noah" }, device: "fixture" }),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    connectorNetwork: provider.network,
  });
  const web = await edge(dist, d.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shots = process.env["VYRE_OAUTH_SHOTS"] ?? "/tmp/vyre-oauth-shots"; fs.mkdirSync(shots, { recursive: true });
  const api = async (token: string, cap: string, input: object): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  };
  const ok = async (token: string, cap: string, input: object): Promise<any> => { const r = await api(token, cap, input); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`); return r.body.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0; const key = (): string => `cb-${++n}`;
  const signIn = async (who: "owner" | "member" | null): Promise<void> => {
    await page.goto(`${web.origin}/healthz`).catch(() => undefined);
    await page.evaluate(([origin, token, person]) => {
      if (!token) { localStorage.removeItem("vyre.session.v1"); return; }
      localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [origin!]: { baseUrl: origin, token, personId: person, marker: "m", def: { spaceId: "spc_core", name: "Core", kind: "team", address: origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} } } } }));
    }, [web.origin, who, who === "owner" ? "usr_olivia" : "usr_noah"] as [string, string | null, string]);
  };
  const callback = async (query: string): Promise<void> => { await page.goto(`${web.origin}/oauth/callback${query}`); await page.getByTestId("oauth-callback").waitFor({ timeout: 20_000 }); };
  const shot = async (name: string): Promise<void> => { await page.screenshot({ path: path.join(shots, `${name}.png`), animations: "disabled" }); };
  const startConnection = async (title: string, code: string) => {
    const made = await ok("owner", "connections.create", { connector: "livepay", title, ownerKind: "person", secrets: { Pay_Client: clientHandle }, idempotencyKey: key() });
    const url = new URL(made.authUrl);
    provider.expect(code, url.searchParams.get("code_challenge")!);
    return { id: made.connection.connectionId as string, state: url.searchParams.get("state")! };
  };
  let clientHandle = "";
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer owner" }, body: JSON.stringify({ key: Buffer.from(new Uint8Array(32).fill(9)).toString("base64") }) })).status, 204);
    const init = await ok("owner", "connectors.init", { key: "livepay", title: "Live Pay", mode: "oauth_app", idempotencyKey: key() });
    const main = (await ok("owner", "files.list", { folder: init.folderId })).files.find((f: { name: string }) => f.name === "connector.toml");
    await ok("owner", "files.write", { fileId: main.fileId, baseVersion: main.version, content: { text: PAY_TOML }, idempotencyKey: key() });
    const actions = (await ok("owner", "files.folder.create", { parentId: init.folderId, name: "actions", idempotencyKey: key() })).folder.folderId;
    await ok("owner", "files.create", { folderId: actions, name: "me.json", content: { text: PAY_ACTION }, idempotencyKey: key() });
    assert.equal((await ok("owner", "connectors.publish", { key: "livepay", idempotencyKey: key() })).published, true);
    const mine = (await ok("owner", "vault.folders.create", { name: "Pay client", scope: "mine", idempotencyKey: key() })).folder.id;
    clientHandle = (await ok("owner", "vault.item.put", { folderId: mine, name: "Pay Client Secret", kind: "api_key", fields: [{ key: "secret", value: CLIENT_SECRET, secret: true }], idempotencyKey: key() })).item.handle;

    await t.test("the owner finishes the sign-in; the code and state leave the address; the connection is active", async () => {
      const c = await startConnection("Dana pay", "code-ONE");
      await signIn("owner");
      await callback(`?state=${c.state}&code=code-ONE`);
      await page.getByText("Account connected", { exact: true }).waitFor({ timeout: 20_000 });
      assert.equal(new URL(page.url()).search, "", "the code and state are out of the address bar");
      assert.equal(await page.evaluate(() => history.length > 0 && !location.href.includes("code-ONE")), true);
      const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
      assert.equal(stored.includes("code-ONE") || stored.includes(c.state), false, "neither is kept in browser storage");
      assert.equal((await ok("owner", "connections.get", { connectionId: c.id })).connection.state, "active");
      await shot("connected-desktop");
      await page.setViewportSize({ width: 390, height: 844 }); await shot("connected-phone");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "fits a phone");
      assert.equal(await page.getByTestId("oauth-callback").count(), 1, "the page is drawn once");
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), "the page does not scroll at phone height");
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId("state-action").click();
      await page.waitForURL(/\/console/);
      // the connection really works: the action runs with the token, and an expired token is refreshed and revoked on delete
      assert.deepEqual((await ok("owner", "connectors.run", { key: "livepay", action: "me", connectionId: c.id, input: {}, idempotencyKey: key() })).output, { name: "Dana" });
      provider.expired.add(provider.access);
      assert.deepEqual((await ok("owner", "connectors.run", { key: "livepay", action: "me", connectionId: c.id, input: {}, idempotencyKey: key() })).output, { name: "Dana" });
      assert.equal(provider.refreshes, 1);
      await ok("owner", "connections.delete", { connectionId: c.id });
      assert.equal(provider.revoked.length, 2, "both tokens are revoked at the app");
    });

    await t.test("the same link again says it was already used", async () => {
      await signIn("owner");
      await callback("?state=oas_used_already&code=code-ONE");
      await page.getByText("This sign-in link has expired or was already used").waitFor({ timeout: 20_000 });
      await shot("used-desktop");
      assert.equal(await page.getByTestId("state-retry").count(), 0, "a spent sign-in is started again, not retried");
      await page.getByTestId("oauth-back").click(); await page.waitForURL(/\/console/);
    });

    await t.test("declining at the app sends no code, spends the state and keeps nothing", async () => {
      const c = await startConnection("Declined pay", "code-TWO");
      const before = provider.seen.length;
      await signIn("owner");
      await callback(`?state=${c.state}&error=access_denied&code=must-not-travel`);
      await page.getByText("The connection was declined").waitFor({ timeout: 20_000 });
      await shot("declined-desktop");
      assert.equal(provider.seen.length, before, "the app was never contacted");
      assert.equal((await ok("owner", "connections.get", { connectionId: c.id })).connection.state, "pending");
      const again = await api("owner", "connections.complete_auth", { state: c.state, code: "code-TWO" });
      assert.equal(again.status, 401, "the state was spent by the decline");
    });

    await t.test("someone else signed in here cannot finish it or spend it; the owner still can", async () => {
      const c = await startConnection("Shared link pay", "code-THREE");
      await signIn("member");
      await callback(`?state=${c.state}&code=code-THREE`);
      await page.getByText("This sign-in was started by someone else").waitFor({ timeout: 20_000 });
      await shot("someone-else-desktop");
      assert.equal(new URL(page.url()).search, "");
      await signIn("owner");
      await callback(`?state=${c.state}&code=code-THREE`);
      await page.getByText("Account connected", { exact: true }).waitFor({ timeout: 20_000 });
      assert.equal((await ok("owner", "connections.get", { connectionId: c.id })).connection.state, "active");
    });

    await t.test("a sign-in left for more than ten minutes has expired", async () => {
      const c = await startConnection("Late pay", "code-FOUR");
      // the module reads its own clock, so the start time of this sign-in is moved back eleven minutes in the Space store
      const store = new DatabaseSync(path.join(dir, "space.db")); store.prepare("UPDATE cn_oauth SET created_at = created_at - ? WHERE state = ?").run(11 * 60_000, c.state); store.close();
      await signIn("owner");
      await callback(`?state=${c.state}&code=code-FOUR`);
      await page.getByText("This sign-in link has expired or was already used").waitFor({ timeout: 20_000 });
    });

    await t.test("nobody signed in: the page says to sign in first and sends nothing", async () => {
      await signIn(null);
      const before = provider.seen.length;
      await callback("?state=oas_x&code=code-FIVE");
      await page.getByText("Sign in to this Space first").waitFor({ timeout: 20_000 });
      await shot("signed-out-desktop");
      assert.equal(new URL(page.url()).search, "");
      assert.equal(provider.seen.length, before);
    });

    await t.test("an address with no state says there is nothing to finish", async () => {
      await signIn("owner");
      await callback("");
      await page.getByText("There is no sign-in to finish").waitFor({ timeout: 20_000 });
      await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark")); await shot("no-state-dark");
    });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); web.close(); await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
