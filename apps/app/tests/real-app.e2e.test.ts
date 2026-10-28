// P-APP_01: the real app against a booted daemon. A seeded Space runs as the daemon process a person starts (host/src/daemon/main.ts); the app's web export is served from a tiny same-origin server that proxies the
// gateway and the live socket to the daemon (the production shape: one origin, no CORS); a real Chromium opens it. What a person does, in order:
//   1 the app opens on sign-in (nothing is signed in)               2 sign in                          3 Home shows the Space's real data
//   4 Chats: send a message and it appears                          5 Records: open a table            6 Files: open a file
// A step whose module is still a stub in host/modules.json is reported as TODO with the packet that makes it live; it is never faked and never counted as a pass. Step 2 is the owner bootstrap
// token (the same door the CLI and the Console use) until the seeded Space carries a member with a password (golden flow 02); it is labelled as such in the output.
// Needs a Chromium (CHROME_BIN, or playwright-core's own) and a web export (VYRE_APP_DIST; without it the test skips with a message). VYRE_REQUIRE_CHROME=1 turns a missing Chromium into a failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createCapCaller } from "../../../client/src/gateway/index.ts";
import { holdKeyOnOwnNode } from "../../../client/src/gateway/local-key.ts";
import { openBundle, wipe } from "../../../client/src/crypto/keys.ts";
import { addJoinedApiKey } from "../src/shell/session/join-provider.ts";
import { routes } from "../../../generated/routes.ts";
import { bootFreshSpace, claimOnEdge, edge, liveModules, todoFor } from "./real-app-harness.test.ts";

function authenticatorCode(secret: string): string {
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function exportApp(): string {
  return process.env["VYRE_APP_DIST"] ?? "";
}

test("the pure parts: a step is TODO with its packet when a module it needs is a stub, and passes through when all are live", () => {
  const live = new Set(["home", "tasks", "records"]);
  assert.equal(todoFor("home", live), null);
  assert.equal(todoFor("records", live), null);
  assert.match(todoFor("chats", live) ?? "", /chat still a stub in host\/modules.json \(live with P-L2_LIVE\)/);
  assert.match(todoFor("sign in", live) ?? "", /identity, spaces, devices .* P-L7_LIVE/);
  assert.throws(() => todoFor("nope", live));
});

test("the real app on a booted daemon: sign-in screen, then Home, Chats, Records and Files from the seeded Space", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) {
    t.skip("VYRE_APP_DIST is not set: the shots job runs this test after the production export (PR 491)");
    return;
  }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`);
    t.skip("no Chromium on this machine");
    return;
  }
  const live = liveModules();
  const space = await bootFreshSpace();
  const dist = exportApp();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // What the app asked the Space and what it answered: a step that times out shows these, so a failure names its cause (a refused call, a console error, the text on screen).
  const seen: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") seen.push(`console.error ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) {
      void r.text().then((b) => { if (r.status() >= 400) seen.push(`${r.status()} ${r.request().method()} ${u.pathname} ${b.slice(0, 200)}`); }).catch(() => undefined);
    }
  });
  // Calls to the Space that carried no bearer token: a 401 "No valid session" can mean the app sent none.
  const bare: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.pathname.startsWith("/v1/") && u.pathname !== "/v1/identity/claim_owner" && u.pathname !== "/v1/identity/sign_in") && !r.headers()["authorization"]) bare.push(`${r.method()} ${u.pathname}`);
  });
  const dump = async (label: string): Promise<void> => {
    const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "(no body)");
    console.log(`real-app e2e ${label}: on screen: ${text.replace(/\s+/g, " ").slice(0, 400)}\n  calls: ${seen.slice(-8).join(" | ") || "(no failed calls)"}\n  without a token: ${bare.slice(0, 6).join(", ") || "(none)"}\n  page errors: ${errors.slice(-3).join(" | ") || "(none)"}`);
  };
  const step = async (label: string, body: () => Promise<void>): Promise<void> => {
    try { await body(); } catch (e) { await dump(label); throw e; }
  };
  const todo: string[] = [];
  let signedIn = false;
  try {
    await t.test("0 a fresh desktop can connect by address without a deep link", async () => {
      await page.goto(`${web.origin}/home?space=tauri%3A%2F%2Flocalhost`, { waitUntil: "load" });
      await page.getByTestId("space-address").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("si-user").count(), 0, "no credentials before choosing a Space");
      fs.mkdirSync("shots-evidence/connect-space", { recursive: true });
      await page.screenshot({ path: "shots-evidence/connect-space/desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "shots-evidence/connect-space/phone.png" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId("space-address").fill("http://untrusted.example");
      assert.equal(await page.getByTestId("resolve-space").getAttribute("aria-disabled"), "true", "remote HTTP is refused");
      await page.getByTestId("space-address").fill("http://127.0.0.1:1");
      await page.getByTestId("resolve-space").click();
      await page.getByTestId("space-error").waitFor({ timeout: 15_000 });
      assert.match(await page.getByTestId("space-error").innerText(), /Check its address/);
      await page.getByTestId("space-address").fill(web.origin);
      await page.getByTestId("resolve-space").click();
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("shell").count(), 0, "discovery does not authenticate or open the shell");
      assert.equal(await page.evaluate(() => localStorage.getItem("vyre.session.v1")), null, "no session is persisted from anonymous discovery");
    });

    await t.test("1 the app opens on sign-in when nobody is signed in", async () => {
      let releaseOptions!: () => void;
      let releaseSignIn!: () => void;
      const optionsGate = new Promise<void>((resolve) => { releaseOptions = resolve; });
      const signInGate = new Promise<void>((resolve) => { releaseSignIn = resolve; });
      await page.route("**/v1/identity/sign_in_options", async (route) => { await optionsGate; await route.continue(); });
      let signInRequests = 0;
      await page.route("**/v1/identity/sign_in", async (route) => { signInRequests++; await signInGate; await route.continue(); });
      try {
        await page.goto(`${web.origin}/home`, { waitUntil: "load" });
        await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
        await page.getByTestId("si-user").fill("typing.user");
        await page.getByTestId("si-password").fill("synthetic typed password");
        await page.getByTestId("next").click();
        assert.equal(await page.getByTestId("next").getAttribute("aria-disabled"), "true");
        releaseOptions();
        await page.getByRole("heading", { name: "Sign in to Fresh Co", exact: true }).waitFor({ timeout: 15_000 });
        assert.equal(await page.getByTestId("si-user").inputValue(), "typing.user", "late Space metadata preserves the username");
        assert.equal(await page.getByTestId("si-password").inputValue(), "synthetic typed password", "late Space metadata preserves the password");
        assert.equal(await page.getByTestId("next").getAttribute("aria-disabled"), "true", "late metadata does not clear an in-flight submission");
        await page.getByTestId("step-sign-in").waitFor();
        await page.getByTestId("si-password").press("Enter");
        releaseSignIn();
        await page.getByTestId("join-error").waitFor({ timeout: 15_000 });
        assert.equal(signInRequests, 1, "Enter cannot duplicate a pending sign-in");
      } finally {
        releaseOptions(); releaseSignIn();
        await page.unroute("**/v1/identity/sign_in_options");
        await page.unroute("**/v1/identity/sign_in");
      }
      // Capture the reference frame only after the synthetic input has been discarded.
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("shell").count(), 0, "no shell before sign-in");
      await page.getByRole("heading", { name: "Sign in to Fresh Co", exact: true }).waitFor({ timeout: 15_000 });
      assert.ok((await page.getByTestId("si-user").boundingBox())!.width > 500, "the username field uses the full reading column");
      const header = await page.getByTestId("auth-form-header").boundingBox();
      const column = await page.getByTestId("step-sign-in").boundingBox();
      const primary = await page.getByTestId("next").boundingBox();
      const surface = await page.getByTestId("join-panel").boundingBox();
      assert.ok(header && column && primary && surface);
      assert.ok(header.y < column.y && primary.y > column.y, "reference header and primary surround the reading column");
      assert.ok(Math.abs(primary.width - column.width) < 2, "the primary fills the reading column");
      assert.ok(surface.height < 624, "the sign-in form sizes to its content");
      fs.mkdirSync("shots-evidence/auth-forms", { recursive: true });
      await page.screenshot({ path: "shots-evidence/auth-forms/signin-light.png" });
      await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark"));
      await page.screenshot({ path: "shots-evidence/auth-forms/signin-dark.png" });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the form fits phone web without sideways scrolling");
      await page.screenshot({ path: "shots-evidence/auth-forms/signin-phone.png" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => document.documentElement.removeAttribute("data-mode"));
    });

    await t.test("2 the owner claims the Space with the one-time link and lands in the shell", async (s) => {
      const gap = todoFor("sign in", live) ?? (space.claim ? null : "claim: the daemon printed no claim link (a fresh install prints one with P-L7_23, #578)");
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("claim", async () => {
        await page.goto(claimOnEdge(space.claim ?? "", web.origin), { waitUntil: "load" });
        // The page names the Space by its name (from the link), never by a host or an address.
        await page.getByText("Set up Fresh Co").first().waitFor({ timeout: 15_000 });
        assert.equal(await page.getByText(/127\.0\.0\.1|localhost/).count(), 0, "no host or address on the claim page");
        await page.getByTestId("claim-name").fill("Olivia Owner");
        await page.getByTestId("claim-username").fill("olivia");
        await page.getByTestId("claim-password").fill("correct horse battery 9");
        await page.getByTestId("claim-confirm").fill("correct horse battery 9");
        await page.getByTestId("claim-next").click();
        await page.getByTestId("claim-saved").click();
        await page.getByTestId("claim-create").click();
        await page.getByTestId("shell").waitFor({ timeout: 30_000 });
        signedIn = true;
      });
    });

    await t.test("3 Home shows real data from the Space", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("home", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("home", async () => {
        await page.getByTestId("rail-home").or(page.getByTestId("rail-home-selected")).first().click();
        await page.getByTestId("s-needs").or(page.getByTestId("home-place")).first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("4 Chats: a message sent from the composer appears in the conversation", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("chats", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("chats", async () => {
        await page.getByTestId("rail-chats").or(page.getByTestId("rail-chats-selected")).first().click();
        await page.getByTestId("chats-place").waitFor({ timeout: 15_000 });
        // A claimed Space starts with no chats: the sidebar then says so (the shared empty state) and there is no composer to type in. With a chat open, a sent message must appear.
        const composer = page.getByTestId("composer-field");
        if (await composer.count() === 0) { await page.getByTestId("state-empty").first().waitFor({ timeout: 15_000 }); return; }
        const text = `real app check ${Date.now()}`;
        await composer.fill(text);
        await composer.press("Enter");
        await page.getByText(text).first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("5 Records: a table opens with its rows", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("records", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("records", async () => {
        await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().click();
        await page.getByTestId("records-place").waitFor({ timeout: 15_000 });
        await page.locator('[data-testid^="rec-"], [data-testid="state-empty"]').first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("6 Files: the list shows files and one opens", async (s) => {
      const gap = (signedIn ? null : "needs the claimed owner session (step 2)") ?? todoFor("files", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await step("files", async () => {
        await page.getByTestId("rail-files").or(page.getByTestId("rail-files-selected")).first().click();
        await page.getByTestId("files-place").waitFor({ timeout: 15_000 });
        await page.locator('[data-testid="files-list"], [data-testid="state-empty"]').first().waitFor({ timeout: 15_000 });
      });
    });

    await t.test("6b real project, record and file routes open, reload and navigate back", async () => {
      assert.ok(signedIn, "the owner must be signed in");
      const token = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("vyre.session.v1") ?? "{}");
        return saved.sessions?.[location.origin]?.token ?? saved.token;
      });
      const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
      const project = await api("projects.create", { type: "project", title: "Release route project", idempotencyKey: "e2e.route.project" }) as { projectId: string; recordId: string; folderId: string };
      const file = (await api("files.create", { folderId: project.folderId, name: "release-route.md", content: { text: "# Release route proof\nThe saved file opens in its viewer." }, idempotencyKey: "e2e.route.file" }) as { file: { fileId: string } }).file;
      await page.goto(`${web.origin}/records#type=project`, { waitUntil: "load" });
      await page.getByText("Release route project", { exact: true }).first().waitFor({ timeout: 15_000 });
      await page.getByText("Release route project", { exact: true }).first().dblclick();
      await page.getByTestId("project-page").waitFor({ timeout: 15_000 });
      assert.ok(page.url().includes("subject="), "opening the record writes its URL");
      await page.getByRole("tab", { name: "Plan", exact: true }).click();
      await page.getByTestId("project-plan").waitFor({ timeout: 15_000 });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("project-plan").waitFor({ timeout: 15_000 });
      await page.goBack();
      await page.getByTestId("project-page").waitFor({ timeout: 15_000 });
      await page.goBack();
      await page.getByTestId("records-table").waitFor({ timeout: 15_000 });
      await page.goto(`${web.origin}/records#subject=record:${project.recordId}&type=project&recordView=fields`, { waitUntil: "load" });
      await page.getByTestId("record-page").waitFor({ timeout: 15_000 });
      await page.goto(`${web.origin}/files#subject=folder:${project.folderId}`, { waitUntil: "load" });
      await page.getByText("release-route.md", { exact: true }).first().waitFor({ timeout: 15_000 });
      await page.getByText("release-route.md", { exact: true }).first().dblclick();
      await page.getByTestId("file-viewer").waitFor({ timeout: 15_000 });
      await page.getByText("The saved file opens in its viewer.").first().waitFor({ timeout: 15_000 });
      assert.ok(page.url().includes(file.fileId), "the file URL survives refresh");
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("file-viewer").waitFor({ timeout: 15_000 });
      await page.goBack();
      await page.getByTestId("files-list").waitFor({ timeout: 15_000 });
      await page.goto(`${web.origin}/files#subject=file:${file.fileId}`, { waitUntil: "load" });
      await page.getByTestId("file-viewer").waitFor({ timeout: 15_000 });
      fs.mkdirSync("shots-evidence/record-file-routes", { recursive: true });
      await page.screenshot({ path: "shots-evidence/record-file-routes/file.png" });
      await page.goto(`${web.origin}/records#subject=project:${project.projectId}`, { waitUntil: "load" });
      await page.getByTestId("project-page").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: "shots-evidence/record-file-routes/project.png" });
    });

    await t.test("6c Console uses real backup, device and access capabilities in its standalone frame", async () => {
      const token = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("vyre.session.v1") ?? "{}");
        return saved.sessions?.[location.origin]?.token ?? saved.token;
      });
      const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
      const backupDir = fs.mkdtempSync("/tmp/vyre-console-backups-");
      const openConsole = async (screen: string): Promise<void> => {
        await page.goto(`${web.origin}/console#screen=${screen}`, { waitUntil: "load" });
        await page.getByTestId("console").waitFor({ timeout: 15_000 });
        assert.equal(await page.getByTestId("shell").count(), 0, "Console has its own frame");
      };
      try {
        await openConsole("console.backups");
        await page.getByTestId("backup-path").fill(backupDir);
        await page.getByTestId("backup-config-save").click();
        await page.getByText("Backup target saved", { exact: true }).waitFor();
        page.on("response", async (response) => { if (new URL(response.url()).pathname === "/v1/backup/run" && response.status() >= 400) console.log(`backup refusal: ${await response.text()}`); });
        await page.getByTestId("backup-run").click();
        const restore = page.locator('[data-testid^="restore-bkp_"]').first();
        await restore.waitFor({ timeout: 20_000 }).catch(async (error) => { console.log(`backup run: list=${JSON.stringify(await api("backup.list", {}))}, screen=${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(-1200)}`); throw error; });
        const backupId = (await restore.getAttribute("data-testid"))!.replace("restore-", "");
        await page.getByTestId(`verify-${backupId}`).click();
        await page.getByText("Backup verified", { exact: true }).waitFor({ timeout: 20_000 });
        await restore.click();
        await page.getByTestId("backup-restore-confirm").waitFor();
        fs.mkdirSync("shots-evidence/console", { recursive: true });
        await page.screenshot({ path: "shots-evidence/console/restore-confirm.png" });
        await page.getByTestId("backup-restore-confirm").click();
        await page.getByText("Restore requested. A staged restore takes effect when the server restarts.", { exact: true }).waitFor({ timeout: 20_000 });
        const pair = await api("identity.pair_create", { purpose: "app", idempotencyKey: "e2e.console.pair" }) as { code: string };
        const anonymous = createCapCaller({ baseUrl: web.origin, token: () => null, routes: async () => routes });
        const second = await anonymous("identity.pair_redeem", { code: pair.code, deviceName: "Console revocation proof", deviceClass: "desktop" }) as { session: { token: string; deviceId: string } };
        await openConsole("devices.sessions");
        await page.getByTestId(`row-console-device-${second.session.deviceId}`).getByRole("button", { name: "Revoke…", exact: true }).click();
        await page.getByTestId("console-revoke-confirm").click();
        await page.getByText("Revoked", { exact: true }).waitFor();
        const secondApi = createCapCaller({ baseUrl: web.origin, token: () => second.session.token, routes: async () => routes });
        await assert.rejects(secondApi("identity.whoami", {}));
        await api("identity.whoami", {});
        await page.screenshot({ path: "shots-evidence/console/devices.png" });
        await api("spaces.switch_address", { mode: "own_domain", host: "console-fixture.example" });
        await openConsole("access.people");
        const roles = await api("access.roles.list", {}) as { roles: { id: string; name: string; permissions: string[] }[] };
        const member = roles.roles.find((role) => /member/i.test(role.name))!;
        await page.getByTestId(`row-invite-role-${member.id}`).click();
        await page.getByTestId("console-invite-create").click();
        await page.getByTestId("console-invite-link").waitFor();
        assert.match(await page.getByTestId("console-invite-link").innerText(), /console-fixture\.example/);
        await openConsole("access.roles");
        await page.getByTestId(`row-console-role-${member.id}`).click();
        await page.getByTestId("console-role-name").fill("Release role proof");
        await page.getByRole("button", { name: "Clone role", exact: true }).click();
        await page.getByText("Role cloned", { exact: true }).waitFor();
        const cloned = (await api("access.roles.list", {}) as { roles: { id: string; name: string; permissions: string[] }[] }).roles.find((role) => role.name === "Release role proof")!;
        await page.getByTestId(`row-console-role-${cloned.id}`).click();
        await page.getByTestId("console-role-permissions").fill(member.permissions.slice(0, 2).join("\n"));
        await page.getByTestId("console-role-preview").click();
        await page.getByTestId("console-role-apply").click();
        await page.getByText("Role updated", { exact: true }).waitFor();
        await page.screenshot({ path: "shots-evidence/console/roles.png" });
        const project = await api("projects.create", { type: "project", title: "Console access proof", idempotencyKey: "e2e.console.resource" }) as { folderId: string };
        await openConsole("access.grants");
        await page.getByTestId("grant-resource-id").fill(project.folderId);
        await page.getByLabel("Subject kind (person, agent, group or role)").fill("role");
        await page.getByTestId("grant-subject-id").fill(member.id);
        await page.getByTestId("grant-add").click();
        await page.getByText("Access granted", { exact: true }).waitFor();
        const grants = await api("access.grants.list", { resource: { type: "folder", id: project.folderId } }) as { grants: { id: string; subject: { kind: string; id: string } }[] };
        const grant = grants.grants.find((item) => item.subject.kind === "role" && item.subject.id === member.id)!;
        assert.ok(grant);
        await page.getByTestId(`row-console-grant-${grant.id}`).getByRole("button", { name: "Revoke…", exact: true }).click();
        await page.getByTestId("grant-revoke-confirm").click();
        await page.getByText("Grant revoked", { exact: true }).waitFor();
        await openConsole("access.checker");
        const who = await api("identity.whoami", {}) as { principal: { id: string } };
        await page.getByTestId("checker-principal").fill(who.principal.id);
        await page.getByTestId("checker-resource").fill(project.folderId);
        await page.getByTestId("checker-run").click();
        await page.getByTestId("checker-decision").filter({ hasText: "allow" }).waitFor();
        await page.screenshot({ path: "shots-evidence/console/access-checker.png" });
        await page.getByTestId("console-open-app").click();
        await page.getByTestId("shell").waitFor();
      } finally { fs.rmSync(backupDir, { recursive: true, force: true }); }
    });

    await t.test("7 every place draws on its own page load, with no page errors", async (s) => {
      const gap = signedIn ? null : "needs the claimed owner session (step 2)";
      if (gap) { todo.push(gap); s.todo(gap); return; }
      // One fresh page per place: a place that loops or throws takes its whole page down, and must not hide the places after it.
      const places: [string, string][] = [
        ["home", '[data-testid="s-needs"], [data-testid="home-place"]'], ["chat", '[data-testid="chats-place"]'], ["mail", '[data-testid="inbox-place"]'], ["records", '[data-testid="records-place"]'],
        ["files", '[data-testid="files-place"]'], ["sites", '[data-testid="place-sites"], [data-testid="place-sites-failed"]'], ["automations", '[data-testid="automations-place"]'],
        ["vault", '[data-testid="vault-place"]'], ["settings", '[data-testid="settings-place"]'],
      ];
      const failures: string[] = [];
      const bareCalls: string[] = [];
      for (const [route, selector] of places) {
        const p = await ctx.newPage();
        const errs: string[] = [];
        const refused: string[] = [];
        const frames: string[] = [];
        const crashes: string[] = [];
        p.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
        p.on("console", (m) => { if (m.text().startsWith("vyre session closed")) frames.push(m.text()); if (m.text().startsWith("vyre place crashed")) crashes.push(m.text().slice(0, 900)); });
        p.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")) void r.request().allHeaders().then((h) => { if (r.status() >= 400) refused.push(`${r.status()} ${u.pathname} auth:${h["authorization"] ? "sent" : "none"}`); else if (!h["authorization"] && !/claim_owner|sign_in/.test(u.pathname)) bareCalls.push(`${u.pathname}`); }).catch(() => undefined); });
        // What the live socket told this page (hello_ok mode and epoch, a purge): a 401 on every call can be a revoked session after a purge.
        p.on("websocket", (ws) => ws.on("framereceived", (f) => { const t = String(f.payload); if (/purge|hello_ok/.test(t)) frames.push(t.slice(0, 140)); }));
        await p.goto(`${web.origin}/${route}`, { waitUntil: "load" });
        await p.getByTestId("shell").waitFor({ timeout: 15_000 }).catch(() => undefined);
        const drew = await p.locator(selector).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
        if (!drew || errs.length || crashes.length) failures.push(`${route}: ${drew ? "drew" : "did not draw"}${errs.length ? `, page errors: ${errs.join(" | ")}` : ""}${refused.length ? `, refused: ${[...new Set(refused)].slice(0, 5).join(", ")}` : ""}${frames.length ? `, live: ${frames.slice(0, 3).join(" ")}` : ""}${crashes.length ? `, crashed: ${crashes[0]}` : ""}`);
        await p.close();
      }
      assert.deepEqual(bareCalls, [], "no request to the Space leaves without the session token");
      assert.deepEqual(failures, [], "every place must draw");
    });

    await t.test("7b joining retries provider setup without reacceptance and respects the own-node key boundary", async () => {
      assert.ok(signedIn, "the owner must be signed in");
      const token = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("vyre.session.v1") ?? "{}");
        return saved.sessions?.[location.origin]?.token ?? saved.token;
      });
      const api = createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
      // The Space owner may unlock Mine on this own node; a joined member may not.
      const wrapped = (await api("identity.keys_get", {})) as { keys: Parameters<typeof openBundle>[1] };
      const ownerKey = await openBundle("correct horse battery 9", { ...wrapped.keys, personKeyByRecovery: wrapped.keys.personKeyByRecovery ?? "" });
      try {
        assert.equal(await holdKeyOnOwnNode(space.url, token, ownerKey.personKey), true);
        const providerId = await addJoinedApiKey(api, { choice: "key", providerKey: "openai", key: "synthetic-owner-api-key" }, "e2e.owner.provider");
        const saved = await api("providers.list", {}) as { providers: Array<{ id: string; scope: string }> };
        assert.ok(saved.providers.some((p) => p.id === providerId && p.scope === "mine"), "the own-node provider is stored in Mine");
      } finally { wipe(ownerKey.personKey); wipe(ownerKey.privateKey); }
      const roles = (await api("access.roles.list", {})) as { roles: Array<{ id: string; name: string }> };
      const role = roles.roles.find((r) => /member/i.test(r.name)) ?? roles.roles[0];
      assert.ok(role, "the Space has an invite role");
      await api("spaces.switch_address", { mode: "own_domain", host: "provider-fixture.example" });
      const invited = await api("members.invites.create", { role: role.id, idempotencyKey: "e2e.provider.invite" }) as { link: string };
      const inviteUrl = new URL(invited.link);
      const code = inviteUrl.pathname.split("/").filter(Boolean).at(-1)!;
      const keyPath = path.join(space.dir, "e2e-https.key");
      const certPath = path.join(space.dir, "e2e-https.crt");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-days", "1", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
      const secureWeb = await edge(dist, space.url, { key: fs.readFileSync(keyPath, "utf8"), cert: fs.readFileSync(certPath, "utf8") });
      const joinedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
      await joinedContext.addInitScript(`{
        const address = ${JSON.stringify(secureWeb.origin)};
        const code = ${JSON.stringify(code)};
        let pending = { action: "join", params: { address, code, fp: "display-marker" } };
        globalThis.__TAURI__ = {
          core: { invoke: async (command) => {
            if (command === "desktop_info") return { app: "Vyre", version: "1.0.0-rc.1", platform: "macos", arch: "aarch64", sidecar: { phase: "ready", url: null, version: "1.0.0-rc.1", restarts: 0, error: null } };
            if (command === "take_pending_link") { const link = pending; pending = null; return link; }
            return null;
          } },
          event: { listen: async () => () => undefined },
        };
      }`);
      const joined = await joinedContext.newPage();
      const joinErrors: string[] = [];
      joined.on("pageerror", (e) => joinErrors.push(e.message.slice(0, 200)));
      joined.on("response", (r) => { if (r.status() >= 400) joinErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      let accepted = 0;
      let providerAttempts = 0;
      joined.on("request", (r) => { if (r.url().includes("/v1/members/accept")) accepted++; });
      await joined.route("**/v1/providers/add", async (route) => {
        providerAttempts++;
        if (providerAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "internal.unavailable", message: "Transient fixture failure", traceId: "fixture-provider" } }) });
        else await route.continue();
      });
      try {
        await joined.goto(`${secureWeb.origin}/home`, { waitUntil: "load" });
        await joined.getByTestId("web").waitFor({ timeout: 15_000 }).catch(async (error) => { console.log(`invite landing: errors=${joinErrors.join(" | ")}, screen=${(await joined.locator("body").innerText()).replace(/\s+/g, " ").slice(0,600)}`); throw error; });
        await joined.getByTestId("web").click();
        await joined.getByTestId("first").fill("Casey");
        await joined.getByTestId("last").fill("Builder");
        await joined.getByTestId("next").click();
        await joined.getByTestId("username").fill("casey.provider");
        await joined.getByTestId("password").fill("correct horse provider 9");
        await joined.getByTestId("confirm").fill("correct horse provider 9");
        await joined.getByTestId("next").click();
        await joined.getByTestId("device").fill("Release desktop");
        await joined.getByTestId("next").click();
        await joined.getByTestId("ai-key").click();
        await joined.getByTestId("ai-provider-openai").click();
        await joined.getByTestId("ai-key-field").fill("synthetic-release-api-key");
        await joined.getByTestId("next").click();
        await joined.getByTestId("joined-provider-continue").waitFor({ timeout: 30_000 }).catch(async (error) => { console.log(`joined setup: accepted=${accepted}, errors=${joinErrors.join(" | ")}, screen=${(await joined.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600)}`); throw error; });
        await joined.getByTestId("joined-provider-continue").click();
        await joined.getByTestId("joined-provider-error").waitFor({ timeout: 15_000 });
        assert.equal(await joined.getByText("Your AI account is connected", { exact: true }).count(), 0);
        await joined.getByTestId("joined-provider-continue").click();
        await joined.getByTestId("joined-provider-error").filter({ hasText: "Mine vault is locked here" }).waitFor({ timeout: 15_000 });
        assert.equal(await joined.getByText("Your API key is saved", { exact: true }).count(), 0, "a Team server never reports Mine saved without the member’s own-node key");
        assert.equal(accepted, 1, "retry never consumes the invite twice");
        assert.equal(providerAttempts, 2);
        assert.equal(await joined.evaluate(() => JSON.stringify(localStorage).includes("synthetic-release-api-key")), false, "raw key is never persisted on the device");
        fs.mkdirSync("shots-evidence/join-provider", { recursive: true });
        await joined.screenshot({ path: "shots-evidence/join-provider/locked-mine.png" });
        await joined.getByTestId("joined-provider-later").click();
        await joined.getByTestId("shell").waitFor({ timeout: 15_000 });
      } finally { await joinedContext.close(); secureWeb.close(); }
    });

    await t.test("7c password change and authenticator setup/removal use real identity capabilities", async () => {
      await page.goto(`${web.origin}/settings`, { waitUntil: "load" });
      await page.getByTestId("row-page-signin").click();
      await page.getByTestId("pw-change").click();
      await page.getByTestId("security-current-password").fill("wrong-current-password");
      await page.getByTestId("security-new-password").fill("correct horse changed 9");
      await page.getByTestId("security-confirm-password").fill("correct horse changed 9");
      await page.getByTestId("security-save").click();
      await page.getByTestId("security-error").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("security-saved").count(), 0, "a wrong password cannot report success");
      await page.getByTestId("security-current-password").fill("correct horse battery 9");
      await page.getByTestId("security-save").click();
      await page.getByTestId("security-saved").waitFor({ timeout: 15_000 }).catch(async (error) => { await dump("security change"); throw error; });
      await page.getByTestId("security-close").click();
      await page.getByTestId("totp-setup").click();
      fs.mkdirSync("shots-evidence/settings-security", { recursive: true });
      await page.screenshot({ path: "shots-evidence/settings-security/setup.png" });
      await page.getByTestId("security-save").click();
      await page.getByTestId("security-setup-uri").waitFor({ timeout: 15_000 });
      const uri = new URL(await page.getByTestId("security-setup-uri").innerText());
      await page.getByTestId("security-totp-code").fill(authenticatorCode(uri.searchParams.get("secret")!));
      await page.getByTestId("security-save").click();
      await page.getByTestId("security-saved").waitFor({ timeout: 15_000 }).catch(async (error) => { await dump("security change"); throw error; });
      await page.getByTestId("security-close").click();
      await page.getByTestId("totp-remove").click();
      await page.getByTestId("security-current-password").fill("correct horse changed 9");
      await page.getByTestId("security-save").click();
      await page.getByTestId("security-saved").waitFor({ timeout: 15_000 }).catch(async (error) => { await dump("security change"); throw error; });
      await page.getByTestId("security-close").click();
    });

    await t.test("8 a session the Space no longer knows lands on sign-in with a calm line, never a blank page", async (s) => {
      const gap = signedIn ? null : "needs the claimed owner session (step 2)";
      if (gap) { todo.push(gap); s.todo(gap); return; }
      const p = await ctx.newPage();
      await p.goto(`${web.origin}/home`, { waitUntil: "load" });
      await p.evaluate(() => {
        const raw = localStorage.getItem("vyre.session.v1");
        if (!raw) return;
        const saved = JSON.parse(raw) as { token?: string; sessions?: Record<string, { token: string }> };
        const active = saved.sessions?.[location.origin];
        if (active) active.token = "vst_not_a_session";
        else saved.token = "vst_not_a_session";
        localStorage.setItem("vyre.session.v1", JSON.stringify(saved));
      });
      await p.reload({ waitUntil: "load" });
      await p.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.ok(await p.getByText("You were signed out").first().isVisible(), "the sign-in page says the person was signed out");
      assert.ok((await p.locator("body").innerText()).trim().length > 0, "not a blank page");
      await p.close();
    });

    assert.deepEqual(errors, [], "the page threw no errors");
  } finally {
    if (todo.length) console.log(`real-app e2e TODO (not a pass):\n  ${todo.join("\n  ")}`);
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
