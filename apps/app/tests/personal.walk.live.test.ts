// The Personal Space first hour, walked in a real browser against the production export and a booted daemon (rc.8 release gate). A fresh Personal Space is claimed the way a person does; then, in order:
//   claim · connect an AI account and get a reply in a new chat · add every Vault kind to Mine · open each Inbox Connect tile · Files (folder, upload) · Records (type, record, edit, Activity, Fields)
//   Automations (from a template) · Settings (theme) · Terminal.
// Every step asserts something a person can SEE. A step that fails is reported with its error and the walk goes on, so one run lists everything that is broken; the test fails at the end if any step did.
// It never skips under VYRE_REQUIRE_CHROME=1 (the release-evidence job sets it). The model is the scripted stand-in the memory live tests use; nothing else inside the daemon is faked.
// Screenshots of each step go to shots-evidence/personal-walk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import type { Page } from "playwright-core";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../../host/src/daemon/daemon.ts";
import { standIn } from "../../../test/memory-live-kit.ts";
import { claimOnEdge, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";
const SHOTS = process.env["VYRE_WALK_SHOTS"] ?? "shots-evidence/personal-walk";

test("a fresh Personal Space: the first hour works end to end in the real app", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-walk-"));
  const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
  const daemon = await startDaemon({
    config: loadConfig(["--role", "space", "--data-dir", dir, "--port", String(port), "--space", "spc_walk", "--space-name", "Personal", "--space-kind", "personal", "--address", `http://127.0.0.1:${port}`], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "walk", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') }),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineOpenSession: standIn,
  });
  assert.ok(daemon.claim, "a fresh Personal Space prints a claim link");
  const web = await edge(dist, daemon.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const refused: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/") && r.status() >= 400) void r.text().then((b) => refused.push(`${r.status()} ${u.pathname} ${b.slice(0, 160)}`)).catch(() => undefined); });
  fs.mkdirSync(SHOTS, { recursive: true });
  const failures: string[] = [];
  let token = "";
  let n = 0;
  const api = async (cap: string, data: unknown = {}): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data });
    const body = (await r.json()) as { data?: unknown };
    return { status: r.status(), data: body.data ?? body };
  };
  /** One step: runs, takes its picture, and on failure records the error and goes on. */
  const step = async (label: string, body: () => Promise<void>): Promise<void> => {
    const seenBefore = refused.length;
    await t.test(label, async () => {
      try { await body(); } catch (e) {
        const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        failures.push(`${label}: ${msg.slice(0, 300)}${refused.length > seenBefore ? ` | refused: ${refused.slice(seenBefore).join(" ; ").slice(0, 400)}` : ""}`);
        throw e;
      } finally {
        await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`) }).catch(() => undefined);
      }
    }).catch(() => undefined);
  };
  const go = async (route: string, ready: string): Promise<void> => {
    await page.goto(`${web.origin}/${route}`, { waitUntil: "load" });
    await page.getByTestId(ready).first().waitFor({ timeout: 20_000 });
  };

  try {
    await step("claim a Personal Space", async () => {
      await page.goto(claimOnEdge(daemon.claim!.url, web.origin), { waitUntil: "load" });
      await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
      await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
      await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click();
      await dismissOnboarding(page);
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
      assert.equal((await api("spaces.get")).data.space.kind, "personal");
    });

    await step("add an AI subscription and get a reply in a new chat", async () => {
      // the account the way the Add an AI provider sheet makes it: a Mine sign-in item, completed, and the Space allowed to use it
      const folder = (await api("vault.folders.create", { name: "Accounts", scope: "mine", idempotencyKey: "w-f1" })).data.folder.id as string;
      const flow = await api("providers.subscription_start", { providerKey: "claude-code", idempotencyKey: "w-flow" });
      assert.equal(flow.status, 200, `subscription_start ${JSON.stringify(flow.data).slice(0, 200)}`);
      const put = await api("vault.item.put", { folderId: folder, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ", secret: true }], idempotencyKey: "w-i1" });
      assert.equal(put.status, 200, `vault.item.put ai_subscription ${JSON.stringify(put.data).slice(0, 200)}`);
      const done = await api("providers.subscription_complete", { flowId: flow.data.flowId });
      assert.equal(done.status, 200, `subscription_complete ${JSON.stringify(done.data).slice(0, 200)}`);
      await go("chat", "chats-place");
      const newChat = page.getByText("New chat", { exact: true }).first();
      await newChat.click({ timeout: 15_000 });
      const composer = page.getByTestId("composer-field").or(page.locator('[data-testid="composer"] textarea')).or(page.locator('[data-testid="composer"] [contenteditable="true"]')).first();
      await composer.waitFor({ timeout: 15_000 });
      const text = `hello from the walk ${Date.now()}`;
      await composer.fill(text);
      await composer.press("Enter");
      await page.getByText(text).first().waitFor({ timeout: 15_000 });
      // the stand-in answers with the prompt it was sent, which contains the message: a second copy of it on screen is the reply
      // a plain greeting must not raise memory cards in the conversation
      assert.equal(await page.getByTestId("memory-card").count(), 0, "no memory card after a greeting");
      await page.waitForFunction((x) => (document.body.innerText.match(new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 2, text, { timeout: 45_000 });
    });

    // every Vault kind, through the Add sheet as a person uses it: the pickers for the app templates, a paste for the rest
    const kinds: [string, string, (p: Page) => Promise<void>][] = [
      ["API key", "Walk API key", async (p) => { await p.getByTestId("add-search").fill("WALK_API_KEY=abc123secretvalue"); }],
      ["env", "Walk env", async (p) => {
        // a real paste: the sheet listens for paste events (a typed fill would strip the newline)
        await p.getByTestId("add-search").evaluate((el) => { const d = new DataTransfer(); d.setData("text", "DB_HOST=localhost\nDB_PASSWORD=hunter2hunter2"); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); });
      }],
      ["Twilio template", "Twilio", async (p) => { await p.getByTestId("add-app-twilio").click(); await p.getByTestId("add-value-0").fill("AC0123456789abcdef0123456789abcdef"); await p.getByTestId("add-value-1").fill("authtokenvalue1234567890"); }],
      ["login", "Walk login", async (p) => { await p.getByTestId("add-app-login").click(); }],
      ["card", "Walk card", async (p) => { await p.getByTestId("add-app-card").click(); }],
    ];
    for (const [kind, name, fill] of kinds) {
      await step(`Vault: add ${kind} to Mine`, async () => {
        await go("vault", "vault-place");
        await page.getByTestId("add-item").click({ timeout: 20_000 });
        await page.getByTestId("add-sheet").waitFor({ timeout: 15_000 });
        await fill(page);
        const nameField = page.getByTestId("add-name");
        await nameField.waitFor({ timeout: 10_000 });
        await nameField.fill(name);
        // login and card templates have rows to fill before Add is live
        for (const i of [0, 1, 2]) { const v = page.getByTestId(`add-value-${i}`); if (await v.count() && (await v.inputValue()) === "") await v.fill(`value-${i}-walk-1234`); }
        await page.waitForFunction(() => document.querySelector('[data-testid="add-save"]')?.getAttribute("aria-disabled") !== "true", null, { timeout: 15_000 });
        const put = page.waitForResponse((r) => r.url().endsWith("/v1/vault/item/put"), { timeout: 15_000 });
        await page.getByTestId("add-save").click();
        const res = await put;
        assert.equal(res.status(), 200, `vault.item.put answered ${res.status()}: ${(await res.text()).slice(0, 200)}`);
        await page.getByText(name, { exact: true }).first().waitFor({ timeout: 15_000 });
        const items = (await api("vault.items.list")).data.items as { name: string; scope: string }[];
        assert.ok(items.some((i) => i.name === name && i.scope === "mine"), `${name} is in Mine`);
      });
    }

    for (const [tile, sheet] of [["gmail", "connect-connector"], ["outlook", "connect-connector"], ["imap", "connect-mailbox"], ["twilio", "add-sheet"]] as const) {
      await step(`Inbox: the ${tile} Connect tile opens its sheet`, async () => {
        await go("mail", "inbox-place");
        const tileEl = page.getByTestId(`connect-${tile}`);
        if (await tileEl.count() === 0) await page.getByTestId("inbox-connect").click({ timeout: 10_000 });
        await page.getByTestId(`connect-${tile}`).first().click({ timeout: 10_000 });
        // Gmail and Outlook open the generic connect sheet or the mail connections page; Other email opens the mailbox sheet; Twilio opens the Vault's Add sheet
        const seen = page.getByTestId(sheet).or(page.getByTestId("connect-mailbox")).or(page.getByTestId("connect-connector")).or(page.getByTestId("mail-connections")).or(page.getByTestId("add-sheet")).first();
        await seen.waitFor({ timeout: 10_000 });
      });
    }

    await step("Files: create a folder and upload a file", async () => {
      await go("files", "files-place");
      // door 1: the empty state's New folder button; door 2: the New menu; door 3: the sidebar +
      const make = async (name: string, open: () => Promise<void>): Promise<void> => {
        await open();
        await page.getByTestId("files-name-input").fill(name);
        await page.getByTestId("files-name-go").click();
        await page.getByText(name, { exact: true }).first().waitFor({ timeout: 15_000 });
      };
      // the empty state offers Add files (upload); folders come from the New menu and the sidebar +
      const emptyChooser = page.waitForEvent("filechooser", { timeout: 10_000 });
      await page.getByText("Add files", { exact: true }).first().click({ timeout: 10_000 });
      await (await emptyChooser).setFiles({ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") });
      await page.getByText("first.txt", { exact: true }).first().waitFor({ timeout: 20_000 });
      await make("Walk folder 1", async () => { await page.getByText("New", { exact: true }).first().click(); await page.getByText("New Folder", { exact: true }).first().click({ timeout: 10_000 }); });
      await make("Walk folder 2", async () => { await page.getByText("New", { exact: true }).first().click(); await page.getByText("New Folder", { exact: true }).first().click({ timeout: 10_000 }); });
      await make("Walk folder 3", async () => { await page.getByRole("button", { name: /new folder|add a folder|^\+$/i }).or(page.locator('[aria-label="New folder"]')).first().click({ timeout: 10_000 }); });
      const folders = (await api("files.list")).data.folders as { name: string }[];
      assert.deepEqual(folders.map((f) => f.name).filter((n) => n.startsWith("Walk folder")).sort(), ["Walk folder 1", "Walk folder 2", "Walk folder 3"], "three real folders exist in the Space");
      // upload from the New menu: the page's file chooser, the file lands in the open folder
      await page.getByText("Walk folder 1", { exact: true }).first().dblclick();
      const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
      await page.getByText("New", { exact: true }).first().click();
      await page.getByText(/^Upload/).first().click({ timeout: 10_000 });
      await (await chooser).setFiles({ name: "walk.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
      await page.getByText("walk.txt", { exact: true }).first().waitFor({ timeout: 20_000 });
    });

    await step("Records: create a Contact, edit a field, see Activity", async () => {
      await go("records", "records-place");
      await page.getByText("Contacts", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByTestId("records-new").click({ timeout: 15_000 });
      const adding = page.getByTestId("records-adding-input");
      await adding.fill("Walk Contact");
      await adding.press("Enter");
      // the new record opens in its own tab, with its history beside it
      await page.getByText("Vyre created it").first().waitFor({ timeout: 15_000 });
      await page.getByRole("tab", { name: "Activity", exact: true }).or(page.getByRole("button", { name: "Activity", exact: true })).or(page.getByText("Activity", { exact: true })).last().click({ timeout: 10_000, force: true }).catch(() => { throw new Error("could not press the Activity tab of the record"); });
      await page.getByText("Vyre created it").first().waitFor({ timeout: 10_000 });
      // edit a field: show the empty ones, give the contact a job title, and see it saved
      await page.getByText(/Show \d+ empty fields/).first().click({ timeout: 10_000 }).catch(() => { throw new Error("could not press Show empty fields"); });
      // fields are click-to-edit cells: the first Empty is Job title
      await page.getByText("Empty", { exact: true }).first().click({ timeout: 10_000 });
      await page.keyboard.type("Counsel");
      await page.keyboard.press("Enter");
      await page.getByText(/Counsel/).first().waitFor({ timeout: 10_000 });
    });

    await step("Records: the Fields panel opens", async () => {
      await go("records", "records-place");
      await page.getByText("Contacts", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByText("Fields", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByTestId("fields-panel").waitFor({ timeout: 15_000 });
    });

    await step("Automations: create one from a template", async () => {
      await go("automations", "automations-place");
      await page.getByText("Weekly digest", { exact: false }).first().click({ timeout: 15_000 });
      await page.getByTestId("builder-body").or(page.getByTestId("canvas-frame")).first().waitFor({ timeout: 20_000 });
    });

    await step("Settings: change the theme", async () => {
      await go("settings", "settings-place");
      await page.getByText("Appearance", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByText("Graphite", { exact: true }).first().click({ timeout: 15_000 });
      const marks = async (): Promise<string> => page.evaluate(() => `data-mode=${document.documentElement.getAttribute("data-mode")} data-theme=${document.documentElement.getAttribute("data-theme")}`);
      await page.waitForFunction(() => document.documentElement.getAttribute("data-mode") === "dark", null, { timeout: 10_000 }).catch(async () => { throw new Error(`picked Graphite, the preview went dark but the app did not: ${await marks()}`); });
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-mode")), "dark", "data-mode follows the chosen skin (the preview reads it)");
      assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), null, "data-theme is set");
      // choosing System again: the preview follows the mode the document is in, not the one it was in
      await page.getByText("System", { exact: true }).first().click({ timeout: 10_000 });
      const mode = await page.evaluate(() => document.documentElement.getAttribute("data-mode"));
      assert.equal(await page.getByTestId("skin-preview").getAttribute("aria-label"), mode === "dark" ? "Preview of Graphite" : "Preview of Paper", `the System preview matches data-mode ${mode}`);
    });

    await step("Terminal: opens", async () => {
      await go("chat", "chats-place");
      // a person opens it from the Space menu (the Space tile at the top of the rail)
      await page.getByTestId("space-tile").click({ timeout: 10_000 });
      await page.getByRole("menuitem", { name: "Open Terminal", exact: true }).click({ timeout: 10_000 });
      await page.getByTestId("chats-terminal").or(page.getByTestId("terminal-list")).or(page.getByTestId("terminal-new")).or(page.getByTestId("terminal-pane-open")).or(page.getByTestId("terminal-pane-empty")).or(page.getByTestId("terminal-pane-hosts")).or(page.getByTestId("terminal-tab")).first().waitFor({ timeout: 20_000 });
    });
  } finally {
    if (failures.length) {
      // the host's own account of what went wrong, so a refused call names its cause
      try {
        daemon.sink.flush();
        const { DatabaseSync } = await import("node:sqlite");
        const rows = new DatabaseSync(daemon.paths.logs, { readOnly: true }).prepare("SELECT level, cap, msg, attrs FROM logs WHERE level >= 40 ORDER BY rowid DESC LIMIT 8").all() as { level: number; cap: string | null; msg: string; attrs: string | null }[];
        console.log(`host log (errors): ${JSON.stringify(rows.map((r) => `${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 400)}`))}`);
      } catch (e) { console.log(`host log unreadable: ${String(e)}`); }
    }
    await browser.close(); web.close(); await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(errors, [], "no page errors");
  assert.deepEqual(failures, [], `${failures.length} step(s) of the Personal first hour fail`);
});
