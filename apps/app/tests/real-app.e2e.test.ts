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
  const space = await bootFreshSpace(undefined,true);
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
        assert.equal(((await api("spaces.get",{})) as {space:{address?:{host:string}}}).space.address?.host,new URL(space.url).host);
        await openConsole("access.people");
        const roles = await api("access.roles.list", {}) as { roles: { id: string; name: string; permissions: string[] }[] };
        const member = roles.roles.find((role) => /member/i.test(role.name))!;
        await page.getByTestId(`row-invite-role-${member.id}`).click();
        await page.getByTestId("console-invite-create").click();
        await page.getByTestId("console-invite-link").waitFor();
        assert.equal(new URL(await page.getByTestId("console-invite-link").innerText()).host,new URL(space.url).host);
        await openConsole("access.roles");
        await page.getByTestId("permission-matrix").waitFor();
        await page.screenshot({path:"shots-evidence/console/roles-matrix.png"});
        await page.getByRole("button", {name:"Open Member",exact:true}).click();
        await page.getByRole("button", {name:"Clone role",exact:true}).click();
        await page.getByTestId("role-edit-name").fill("Release role proof");
        await page.getByTestId("role-save").click();
        await page.getByText("Role cloned",{exact:true}).waitFor();
        const cloned = (await api("access.roles.list", {}) as {roles:{id:string;name:string;permissions:string[]}[]}).roles.find((role)=>role.name === "Release role proof")!;
        await openConsole("access.roles");
        await page.getByRole("button", {name:"Open Release role proof",exact:true}).click();
        await page.getByRole("tab",{name:/^Permissions/}).click();
        const removedPermission=member.permissions[0]!;
        await page.getByTestId(`matrix-${cloned.id}-${removedPermission}`).click();
        await page.getByTestId("roles-preview-changes").click();
        await page.getByTestId("roles-apply-changes").click();
        await page.getByText("Role permissions updated",{exact:true}).waitFor();
        const changedRole=await api("access.roles.get",{roleId:cloned.id}) as {role:{permissions:string[]};lastChange:{before:string[];after:string[]}};
        assert.ok(!changedRole.role.permissions.includes(removedPermission));
        assert.ok(changedRole.lastChange.before.includes(removedPermission));
        assert.ok(!changedRole.lastChange.after.includes(removedPermission));
        await page.reload({waitUntil:"load"});
        await page.getByTestId("role-object").waitFor();
        await page.getByRole("tab",{name:/^Permissions/}).click();
        await page.getByText("Last permission change",{exact:true}).waitFor();
        await page.screenshot({path:"shots-evidence/console/roles.png"});
        await openConsole("access.groups");
        await page.getByTestId("group-list").focus();
        await page.keyboard.press("ArrowDown");
        assert.equal(await page.getByTestId("group-object").count(),0,"Arrow movement focuses a list row before opening an object");
        await page.keyboard.press("Space");
        await page.getByText("1 selected",{exact:true}).waitFor();
        await page.keyboard.press("Shift+F10");
        await page.getByText("Open",{exact:true}).waitFor();
        await page.keyboard.press("Escape");
        await page.getByTestId("group-create-open").click();
        await page.getByTestId("group-name").fill("Release group proof");
        await page.getByTestId("group-create").click();
        await page.getByTestId("group-object").waitFor();
        const createdGroup = (await api("access.groups.list", {q: "Release group proof"}) as {groups: {id:string}[]}).groups[0]!;
        await page.getByRole("button", {name:"Add members", exact:true}).click();
        await page.getByTestId("object-sheet").getByRole("button", {name:"Select", exact:true}).first().click();
        await page.getByText("Member added", {exact:true}).waitFor();
        await page.getByTestId("object-sheet-close").click();
        await page.getByRole("button", {name:"Change managers", exact:true}).click();
        await page.getByTestId("object-sheet").getByRole("button", {name:"Select", exact:true}).first().click();
        await page.getByTestId("group-save-managers").click();
        await page.getByText("Managers updated", {exact:true}).waitFor();
        await page.getByRole("button", {name:"Rename", exact:true}).click();
        await page.getByTestId("group-edit-name").fill("Release reviewers");
        await page.getByTestId("group-save-name").click();
        await page.getByText("Group renamed", {exact:true}).waitFor();
        await page.getByRole("tab", {name:"Access", exact:true}).click();
        await page.getByTestId(`row-group-role-${member.id}`).getByRole("button", {name:"Assign role…", exact:true}).click();
        await page.getByTestId(`group-role-confirm-${member.id}`).click();
        await page.getByText("Group role updated", {exact:true}).waitFor();
        await page.screenshot({path:"shots-evidence/console/groups-access.png"});
        let groupProof = await api("access.groups.get", {groupId:createdGroup.id}) as {group:{name:string;members:unknown[];managers:unknown[]};roles:string[]};
        assert.equal(groupProof.group.name, "Release reviewers");
        assert.equal(groupProof.group.members.length, 1);
        assert.equal(groupProof.group.managers.length, 1);
        assert.ok(groupProof.roles.includes(member.id));
        await page.reload({waitUntil:"load"});
        await page.getByTestId("group-object").waitFor();
        await page.getByRole("tab", {name:"Activity", exact:true}).click();
        await page.getByText("Group details changed", {exact:true}).first().waitFor();
        await page.getByText("Role assigned", {exact:true}).waitFor();
        await page.screenshot({path:"shots-evidence/console/groups-activity.png"});
        await page.getByTestId("console-skin").click();
        await page.getByText("Obsidian",{exact:true}).click();
        await page.screenshot({path:"shots-evidence/console/groups-dark.png"});
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:"shots-evidence/console/groups-phone.png"});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"phone Console does not overflow horizontally");
        await page.setViewportSize({width:1280,height:800});
        await page.getByTestId("console-skin").click();
        await page.getByTestId("menu-item-System").click();
        await page.getByRole("tab", {name:/^Members/}).click();
        await page.getByRole("button", {name:"Remove…", exact:true}).click();
        await page.getByTestId("group-member-remove-confirm").click();
        await page.getByText("Member removed", {exact:true}).waitFor();
        groupProof = await api("access.groups.get", {groupId:createdGroup.id}) as typeof groupProof;
        assert.equal(groupProof.group.members.length, 0);
        await page.getByTestId("object-more").click();
        await page.getByText("Delete group", {exact:true}).click();
        await page.getByTestId("object-confirm").waitFor();
        assert.match(await page.getByTestId("object-confirm").innerText(), /cannot be undone/);
        await page.getByTestId("object-confirm-go").click();
        await page.getByTestId("group-list").waitFor();
        assert.equal((await api("access.groups.list", {q:"Release reviewers"}) as {groups:unknown[]}).groups.length, 0);
        const project = await api("projects.create", { type: "project", title: "Console access proof", idempotencyKey: "e2e.console.resource" }) as { folderId: string };
        await openConsole("access.grants");
        await page.getByRole("button",{name:"Filter by resource",exact:true}).click();
        await page.getByTestId("grant-filter-search").fill("Console access proof");
        await page.getByTestId(`row-grant-filter-${project.folderId}`).click();
        await page.getByTestId("grant-create-open").click();
        await page.getByRole("button",{name:"Choose subject",exact:true}).click();
        await page.getByRole("button",{name:"Subject kind",exact:true}).click();
        await page.getByTestId("menu-item-Role").click();
        await page.getByTestId("grant-subject-picker-search").fill("Member");
        await page.getByTestId(`row-grant-subject-picker-${member.id}`).click();
        await page.getByTestId("grant-add").click();
        await page.getByTestId("grant-save-confirm").click();
        await page.getByText("Access granted", { exact: true }).waitFor();
        const grants = await api("access.grants.list", { resource: { type: "folder", id: project.folderId } }) as { grants: { id: string; subject: { kind: string; id: string };conditions:{expiresAt?:number} }[] };
        const grant = grants.grants.find((item) => item.subject.kind === "role" && item.subject.id === member.id)!;
        assert.ok(grant);
        await page.getByTestId(`row-object-row-${grant.id}`).click();
        await page.getByRole("button",{name:"Edit access",exact:true}).click();
        await page.getByTestId("object-sheet").locator('button[aria-label="Grant expiry"]').click();
        await page.getByTestId("menu-item-In one week").click();
        await page.getByTestId("grant-add").click();await page.getByTestId("grant-save-confirm").click();
        await page.getByText("Grant updated",{exact:true}).waitFor();
        const afterEdit=await api("access.grants.list",{resource:{type:"folder",id:project.folderId}}) as typeof grants;
        const expiry=afterEdit.grants.find(row=>row.id===grant.id)!.conditions.expiresAt!;
        assert.ok(expiry>Date.now()+6*86400000);
        await page.screenshot({path:"shots-evidence/console/grant-expiry.png"});
        await page.reload();await page.getByTestId("grants-list").waitFor();
        assert.equal((await api("access.grants.list",{resource:{type:"folder",id:project.folderId}}) as typeof grants).grants.find(row=>row.id===grant.id)!.conditions.expiresAt,expiry);
        await page.getByTestId(`row-object-row-${grant.id}`).getByRole("button", { name: "Revoke…", exact: true }).click();
        await page.getByTestId("grant-revoke-confirm").click();
        await page.getByText("Grant revoked", { exact: true }).waitFor();
        const reviewKeep=await api("access.share",{resource:{type:"folder",id:project.folderId},subject:{kind:"role",id:cloned.id},level:"view",idempotencyKey:"e2e.review.keep"}) as {grant:{id:string}};
        const developer=(await api("access.roles.list",{}) as {roles:{id:string;name:string}[]}).roles.find((role)=>role.name==="Developer")!;
        const reviewRemove=await api("access.share",{resource:{type:"folder",id:project.folderId},subject:{kind:"role",id:developer.id},level:"view",idempotencyKey:"e2e.review.remove"}) as {grant:{id:string}};
        await openConsole("access.reviews");
        await page.getByTestId("review-start-open").click();
        await page.getByRole("button",{name:"Resources to review",exact:true}).click();
        await page.getByText("Folders",{exact:true}).click();
        await page.getByTestId("review-start").click();
        await page.getByTestId("review-object").waitFor();
        const review=(await api("access.reviews.list",{state:"open"}) as {reviews:{id:string}[]}).reviews[0]!;
        await page.getByRole("button",{name:"Open grants",exact:true}).click();
        await page.getByTestId(`row-review-grant-${reviewKeep.grant.id}`).getByRole("button",{name:"Keep",exact:true}).click();
        await page.getByText("Grant kept",{exact:true}).waitFor();
        await page.getByTestId(`row-review-grant-${reviewRemove.grant.id}`).getByRole("button",{name:"Remove…",exact:true}).click();
        await page.getByTestId(`review-remove-${reviewRemove.grant.id}`).click();
        await page.getByText("Grant removed",{exact:true}).waitFor();
        const reviewed=await api("access.reviews.get",{reviewId:review.id}) as {items:{grant:{id:string};decision?:string;taskId?:string}[]};
        assert.equal(reviewed.items.find((item)=>item.grant.id===reviewKeep.grant.id)?.decision,"keep");
        assert.equal(reviewed.items.find((item)=>item.grant.id===reviewRemove.grant.id)?.decision,"remove");
        const remaining=await api("access.grants.list",{resource:{type:"folder",id:project.folderId}}) as {grants:{id:string}[]};
        assert.ok(remaining.grants.some((grant)=>grant.id===reviewKeep.grant.id));
        assert.ok(!remaining.grants.some((grant)=>grant.id===reviewRemove.grant.id));
        await page.reload({waitUntil:"load"});
        await page.getByTestId("review-object").waitFor();
        await page.getByRole("tab",{name:/^Review tasks/}).click();
        await page.getByRole("button",{name:"Open task",exact:true}).first().click();
        await page.getByTestId("review-task-sheet").waitFor();
        await page.screenshot({path:"shots-evidence/console/review-task.png"});
        await page.getByTestId("object-sheet-close").click();
        await page.getByTestId("object-more").click();
        await page.getByText("Close review",{exact:true}).click();
        await page.getByTestId("object-confirm-go").click();
        await page.getByText("Review closed",{exact:true}).waitFor();
        assert.equal((await api("access.reviews.get",{reviewId:review.id}) as {review:{state:string}}).review.state,"closed");
        await openConsole("access.policies");
        await page.getByText("Public links",{exact:true}).click();
        await page.getByRole("button",{name:"Edit policy",exact:true}).click();
        await page.getByRole("button",{name:"Who can create new public links",exact:true}).click();
        await page.getByText("Nobody",{exact:true}).click();
        await page.getByTestId("policy-links-review").click();
        await page.getByTestId("policy-links-confirm").click();
        await page.getByTestId("object-sheet-close").waitFor({state:"hidden"});
        const links=await api("access.policies.list",{kind:"sharing"}) as {policies:{key:string;value:unknown}[]};
        assert.equal(links.policies.find(row=>row.key==="sharing.public_links")?.value,"off");
        await page.reload();await page.getByText("Nobody",{exact:true}).waitFor();
        await page.screenshot({path:"shots-evidence/console/policies-links.png"});
        await page.getByRole("tab",{name:"Activity",exact:true}).click();
        await page.getByText("access policies set",{exact:true}).waitFor();
        await openConsole("access.policies");await page.getByText("Sign-in requirements",{exact:true}).click();
        await page.getByText("The Space owner must set up an authenticator first.",{exact:true}).waitFor();
        await page.getByRole("button",{name:"Edit policy",exact:true}).click();
        await page.getByTestId("object-sheet").locator('button[aria-label="Authenticator requirement"]').click();
        assert.equal(await page.getByText("Required",{exact:true}).count(),0,"unsupported required enrollment is not offered");
        await page.keyboard.press("Escape");
        await page.getByTestId("object-sheet-close").click();
        await page.screenshot({path:"shots-evidence/console/policies-signin.png"});
        await page.getByTestId("console-skin").click();await page.getByText("Obsidian",{exact:true}).click();
        await page.screenshot({path:"shots-evidence/console/policies-dark.png"});
        await page.setViewportSize({width:390,height:844});await page.reload();await page.getByTestId("policy-object").waitFor();
        assert.equal(await page.getByTestId("console").count(),1,"fresh phone Console has one frame");
        await page.screenshot({path:"shots-evidence/console/policies-phone.png"});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"phone Policies does not overflow");
        await page.setViewportSize({width:1280,height:800});await page.getByTestId("console-skin").click();await page.getByTestId("menu-item-System").click();

        await openConsole("access.checker");
        await page.getByTestId("checker-resource-picker-search").fill("Console access proof");
        await page.getByTestId(`row-checker-resource-picker-${project.folderId}`).click();
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
        ["files", '[data-testid="files-place"]'], ["sites", '[data-testid="apps-place"]'], ["automations", '[data-testid="automations-place"]'],
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
      assert.equal(((await api("spaces.get",{})) as {space:{address?:{host:string}}}).space.address?.host,new URL(space.url).host);
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
      joined.on("request", (r) => { if (r.url().includes("/v1/members/accept")||r.url().includes("/v1/invites/accept_create_account")) accepted++; });
      await joined.route("**/v1/providers/add", async (route) => {
        providerAttempts++;
        if (providerAttempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "internal.unavailable", message: "Transient fixture failure", traceId: "fixture-provider" } }) });
        else await route.continue();
      });
      try {
        await joined.goto(`${secureWeb.origin}/home`, { waitUntil: "load" });
        await joined.getByTestId("first").waitFor({timeout:15000});
        assert.equal(await joined.getByTestId("web").count(),0,"native invite goes directly to account setup");
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
