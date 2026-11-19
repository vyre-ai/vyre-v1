// The whole of "connect Vyre for Chrome straight to a Space" in a real headless Chromium with the unpacked extension and NO native host (a computer with no Vyre app), against a booted Space daemon:
// the panel offers Connect a Space, the address opens the Space's page in a tab, one press hands a bound one-time code to the extension, the panel fills in by itself, a Vault login fills a page
// through the Space's socket, a changed password is offered as an update and saved, and signing out forgets the link. The Space's own /chrome/connect page (apps/app) is stood in for here by a small
// page that makes the same calls with the same session, because the test daemon does not serve the web app. Screenshots go to VYRE_SHOT_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { issueSessionToken } from "../src/daemon/session.ts";
import { provisionAccount } from "../../modules/identity/projections.ts";
import type { IdentityCtx } from "../../modules/identity/projections.ts";
import { findChromium, launch, site } from "../../apps/chrome/tests/e2e/rig.ts";
import { boxOf, press } from "../../apps/chrome/tests/e2e/pierce.ts";

const found = await findChromium();
/** The Space is the same release as the extension, as a person's own would be. */
const EXT_VERSION = (
  JSON.parse(
    fs.readFileSync(path.join(fileURLToPath(new URL("../../apps/chrome", import.meta.url)), "manifest.json"), "utf8"),
  ) as { version_name: string }
).version_name;

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });

/** This repo with the devices module live (device sessions are its rows), as chrome-bridge.person.live.test.ts builds it. */
function codeRootWithDevicesLive(): string {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-walk-"));
  for (const name of fs.readdirSync(repo))
    if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host")))
    if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as {
    modules: { id: string; status: string }[];
  };
  const dev = list.modules.find((m) => m.id === "devices");
  assert.ok(dev);
  dev.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

async function boot(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-walk-data-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, EXT_VERSION),
    codeRoot: codeRootWithDevicesLive(),
    platform: fakePlatform({
      os: "linux",
      hostname: "chrome-walk",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: {
      fast: 3_600_000,
      slow: 3_600_000,
      encryption: 3_600_000,
      commands: 3_600_000,
      tick: 3_600_000,
      hooks: 3_600_000,
    },
  });
}

/** A person signed in with Vyre for Chrome: a device of class extension and its session, as identity.pair_redeem records it, and the token the extension holds. */
function signIn(d: Daemon, person: string, n: string): string {
  const now = Date.now();
  d.db!.run(
    `INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`,
    `dev_${n}`,
    person,
    `Chrome ${n}`,
    now,
    now,
  );
  d.db!.run(
    `INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`,
    `ses_${n}`,
    person,
    `dev_${n}`,
    now,
    now,
  );
  return issueSessionToken(d.db!, `ses_${n}`);
}

/** A capability call over plain HTTP with a person's own session, the way their app makes it. */
async function call(d: Daemon, token: string, cap: string, input: Record<string, unknown>) {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const body = (await r.json()) as { data?: any; error?: any };
  return { status: r.status, data: body.data, error: body.error };
}

const OLD = "kept-in-the-vault-9";
const NEWPW = "changed-on-the-site-42";
const USERNAME = "dana@acme.test";

const LOGIN = (action: string) => `<!doctype html><meta charset="utf-8"><title>Acme Portal · Sign in</title>
<style>body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}main{max-width:380px;margin:80px auto;background:#fff;border:1px solid #E4E8F0;border-radius:12px;padding:26px}
label{display:block;font-size:12px;color:#6B778C;margin:12px 0 4px}input{width:100%;box-sizing:border-box;height:38px;border:1px solid #D5DBE6;border-radius:8px;padding:0 12px;font:inherit}button{margin-top:18px;width:100%;height:40px;border:0;border-radius:8px;background:#2f5d50;color:#fff;font:inherit}</style>
<main><h1>Acme Portal</h1><form method="post" action="${action}"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main>`;
const DASH = `<!doctype html><meta charset="utf-8"><title>Acme Portal</title><body style="font:15px system-ui;background:#F5F7FB;padding:40px"><h1>Signed in</h1>`;

/** The Space's /chrome/connect page for this test: signed in as the person, one press makes the bound code and hands it to this window, as apps/app's page does. */
const connectPage = (token: string) => `<!doctype html><meta charset="utf-8"><title>Connect Chrome · Northwind</title>
<body style="font:16px system-ui;background:#141417;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Connect Chrome to Northwind</h2><button id="go" style="height:38px;padding:0 24px;border-radius:9px;border:0;background:#8b8bff;color:#fff;font:inherit">Connect</button><p id="s"></p></div>
<script>
const challenge = /#challenge=([0-9a-f]{64})/.exec(location.hash)[1];
addEventListener("message", (e) => { if (e.source === window && e.data && e.data.type === "vyre.chrome.linked") document.getElementById("s").textContent = e.data.ok ? "Connected" : "Not answered"; });
document.getElementById("go").onclick = async () => {
  const r = await fetch("/v1/identity/pair_create", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer ${token}" }, body: JSON.stringify({ purpose: "extension", challenge, idempotencyKey: "walk-" + Math.random() }) });
  const j = await r.json();
  postMessage({ type: "vyre.chrome.code", code: j.data.code }, location.origin);
};
</script>`;

test(
  "no Vyre app: connect Chrome to a Space from the panel, fill a Vault login, save a changed password, sign out",
  { skip: !found && "no Chromium on this machine", timeout: 120_000 },
  async () => {
    const d = await boot();
    const srv = await site({ "/login": LOGIN("/dashboard"), "/dashboard": DASH });
    try {
      await provisionAccount(
        {
          space: "spc_core",
          trace: { traceId: "t".repeat(32) },
          now: () => Date.now(),
          db: d.db,
          emit: () => undefined,
        } as unknown as IdentityCtx,
        { personId: "usr_olivia", username: "walker", name: "Olivia", secret: "correct horse battery staple 9" },
      );
      const owner = signIn(d, "usr_olivia", "walk01");
      // the login the person keeps in the Vault, for the page the test serves
      const folder = await call(d, owner, "vault.folders.create", {
        idempotencyKey: "w-f",
        name: "Tools",
        scope: "shared",
      });
      assert.equal(folder.status, 200, JSON.stringify(folder.error));
      const put = await call(d, owner, "vault.item.put", {
        idempotencyKey: "w-i",
        folderId: folder.data.folder.id,
        name: "Acme Portal",
        kind: "login",
        fields: [
          { key: "url", value: srv.url },
          { key: "username", value: USERNAME },
          { key: "password", value: OLD, secret: true },
        ],
      });
      assert.equal(put.status, 200, JSON.stringify(put.error));

      const r = await launch(found!, { noHost: true });
      try {
        // the Space's own page, in the tab the panel opens
        await r.context.route(`${d.url}/chrome/connect*`, (route: any) =>
          route.fulfill({ status: 200, contentType: "text/html", body: connectPage(owner) }),
        );
        const page = await r.context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(srv.url + "/login");
        const winId = await r.worker.evaluate(async () => {
          const c = (globalThis as any).chrome;
          const [t] = await c.tabs.query({ active: true });
          return t.windowId;
        });
        const waiting = r.context.waitForEvent("page", {
          predicate: (p: any) => p.url().includes("/src/panel/panel.html"),
        });
        await r.worker.evaluate(async (w: number) => {
          await (globalThis as any).chrome.windows.create({
            url: `src/panel/panel.html?window=${w}`,
            type: "popup",
            width: 400,
            height: 760,
            focused: false,
          });
        }, winId);
        const panel = await waiting;
        await panel.setViewportSize({ width: 400, height: 760 });

        // 1. no app: the panel offers to connect a Space
        await panel.waitForSelector("#laddr");
        assert.match(await panel.innerText("#main"), /Connect a Space/);
        assert.match(await panel.innerText("#main"), /Not installed/);
        await r.shot(panel, "connect-1-box");
        // a bad address is refused in words and opens nothing
        await panel.fill("#laddr", "not an address");
        await panel.click("text=Connect >> nth=-1");
        await panel.waitForSelector("text=That is not a Space address.");
        // 2. the address opens the Space's page in a tab; the panel waits
        await panel.fill("#laddr", d.url);
        const opened = r.context.waitForEvent("page", {
          predicate: (p: any) => p.url().startsWith(`${d.url}/chrome/connect`),
        });
        await panel.click("text=Connect >> nth=-1");
        const connectTab = await opened;
        await panel.waitForSelector("text=Finish in the");
        await r.shot(panel, "connect-2-waiting");
        // a tab the extension opened is outside the context's routes: route it and load it again, the address (with its hash) kept
        const addr = connectTab.url();
        await connectTab.route(`${d.url}/chrome/connect*`, (route: any) =>
          route.fulfill({ status: 200, contentType: "text/html", body: connectPage(owner) }),
        );
        void addr;
        await connectTab.reload();
        await connectTab.waitForSelector("#go", { timeout: 8000 }).catch(async (e: Error) => {
          throw new Error(`${e.message} :: ${connectTab.url()} :: ${(await connectTab.content()).slice(0, 300)}`);
        });
        await r.shot(connectTab, "connect-2-space-page");
        // 3. one press on the Space's page: the extension is linked and the panel fills in by itself
        await connectTab.click("#go");
        await connectTab.waitForSelector("text=Connected", { timeout: 15_000 });
        await panel.waitForSelector("#q", { timeout: 12_000 }).catch(async (e: Error) => {
          await r.shot(panel, "connect-3-stuck");
          throw new Error(`${e.message} :: ${(await panel.innerText("body")).slice(0, 300)}`);
        });
        await r.shot(panel, "connect-3-connected");
        const links = await r.worker.evaluate(
          async () => (await (globalThis as any).chrome.storage.local.get("vyreLinks")).vyreLinks,
        );
        assert.equal(links.length, 1);
        assert.equal(links[0].address, d.url);
        const devices = d.db!.all(`SELECT name, class FROM devices_device WHERE class = 'extension'`) as {
          name: string;
          class: string;
        }[];
        assert.deepEqual(
          devices.map((x) => x.name),
          ["Chrome on this computer"],
          "listed under Sign-in and devices",
        );

        // 4. a Vault login fills a page through the Space's socket
        await page.bringToFront();
        await page.goto(srv.url + "/login");
        await page.click("#em");
        const badge = await boxOf(page, "button", "Sign in with Vyre");
        await page.mouse.click(badge.x, badge.y);
        await boxOf(page, "button", "Acme Portal");
        await r.shot(page, "connect-4-picker");
        await press(page, "button", "Acme Portal");
        for (let i = 0; i < 80 && (await page.inputValue("#pw")) !== OLD; i++)
          await new Promise((x) => setTimeout(x, 100));
        assert.equal(await page.inputValue("#em"), USERNAME);
        assert.equal(await page.inputValue("#pw"), OLD);
        await r.shot(page, "connect-4-filled");

        // 5. the person changes the password on the site: Update is offered and saved
        await page.goto(srv.url + "/login");
        await page.fill("#em", USERNAME);
        await page.fill("#pw", NEWPW);
        await page.click("button[type=submit]");
        await boxOf(page, "button", "Update", 8000);
        await new Promise((x) => setTimeout(x, 300));
        await r.shot(page, "connect-5-update");
        await press(page, "button", "Update");
        let known = "";
        for (let i = 0; i < 50 && known !== "known"; i++) {
          await new Promise((x) => setTimeout(x, 200));
          known =
            (await call(d, owner, "vault.login.check", { url: srv.url, username: USERNAME, password: NEWPW })).data
              ?.state ?? "";
        }
        assert.equal(known, "known", "the Vault now holds the new password");

        // 6. signing out here forgets the link, and the panel offers Connect a Space again
        await panel.bringToFront();
        await panel.click('[data-a="space"]');
        await panel.click("text=Disconnect");
        await panel.waitForSelector("#laddr", { timeout: 15_000 });
        await r.shot(panel, "connect-6-signed-out");
        const after = await r.worker.evaluate(
          async () => (await (globalThis as any).chrome.storage.local.get("vyreLinks")).vyreLinks,
        );
        assert.deepEqual(after ?? [], []);
      } finally {
        await r.close();
      }
    } finally {
      await srv.close();
      await d.stop();
    }
  },
);
