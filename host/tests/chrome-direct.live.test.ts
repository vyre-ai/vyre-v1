// Vyre for Chrome connected straight to a Space (host/src/routes/chrome-direct.ts, lib/chrome-socket.ts): a booted daemon answers the socket at /chrome/v1/socket for a device
// session and for nothing else. Every call runs as that session's person through the gateway; the admin token, a web page and a made-up token are turned away; a login kept in the
// Vault is filled into a page field by pushing the value down the socket that asked, and to no other.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
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
import { CHROME_SOCKET_PATH } from "../src/routes/chrome-direct.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-direct-"));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-direct-data-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithDevicesLive(),
    platform: fakePlatform({
      os: "linux",
      hostname: "chrome-direct",
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

interface Ext {
  got: Record<string, any>[];
  closed: Promise<number>;
  say(m: unknown): void;
  /** Wait for the first message that fits, among those already here and those to come. */
  next(what: string, fits: (m: Record<string, any>) => boolean): Promise<Record<string, any>>;
  rpc(body: Record<string, unknown>): Promise<Record<string, any>>;
  end(): void;
}

/** The extension's end of the socket: a WebSocket to the Space's address and a hello with its own session. */
async function connect(d: Daemon, token: string | null): Promise<Ext> {
  const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}${CHROME_SOCKET_PATH}`);
  const got: Record<string, any>[] = [];
  const waiters: { fits: (m: Record<string, any>) => boolean; done: (m: Record<string, any>) => void }[] = [];
  let seq = 0;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as Record<string, any>;
    got.push(m);
    for (const w of [...waiters])
      if (w.fits(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.done(m);
      }
  });
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("the socket did not open")));
  });
  const ext: Ext = {
    got,
    closed,
    say: (m) => ws.send(JSON.stringify(m)),
    next(what, fits) {
      const have = got.find(fits);
      if (have) return Promise.resolve(have);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`never came: ${what}`)), 20_000);
        waiters.push({
          fits,
          done: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    rpc(body) {
      const id = `r${++seq}`;
      ws.send(JSON.stringify({ id, ...body }));
      return ext.next(`the answer to ${String(body["op"] ?? body["capability"])}`, (m) => m["id"] === id);
    },
    end: () => ws.close(),
  };
  if (token !== null) ext.say({ type: "hello", token });
  return ext;
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

/** The status a plain upgrade request gets, with the headers given (a browser page names its origin; Node's own WebSocket cannot be told to). */
function upgradeStatus(d: Daemon, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(d.url);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: CHROME_SOCKET_PATH,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("response", (res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    req.on("upgrade", (res, socket) => {
      resolve(res.statusCode ?? 0);
      socket.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}

test("the Space's own socket answers a device session as its person, and turns away the admin token, a made-up token, a web page and a signed-out session", async () => {
  const d = await boot();
  try {
    const member = signIn(d, "usr_noah", "noah01");

    // a web page cannot open it; an extension and a program with no origin can
    assert.equal(await upgradeStatus(d, { origin: "https://evil.example" }), 403);
    assert.equal(await upgradeStatus(d, { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" }), 101);

    // the daemon's admin token is nobody here, and neither is a token nobody issued
    for (const bad of [d.token, "vst_" + "0".repeat(64)]) {
      const no = await connect(d, bad);
      assert.deepEqual(await no.next("the refusal", (m) => m["type"] === "refused"), {
        type: "refused",
        code: "signed_out",
      });
      assert.equal(await no.closed, 4401);
    }

    const ext = await connect(d, member);
    const ready = await ext.next("ready", (m) => m["type"] === "ready");
    assert.equal(ready["person"], "usr_noah");
    assert.equal(typeof ready["space"].id, "string");

    // who it acts as: Scout is the member's own agent (fixtures/seed/core/recipe.ts), and the Space switcher lists this one Space
    const agents = await ext.rpc({ type: "bridge", op: "agents.list", input: { section: "personal" } });
    assert.deepEqual(
      agents["output"].agents.map((a: { name: string }) => a.name),
      ["Scout"],
    );
    const hello = await ext.rpc({ type: "bridge", op: "hello", input: {} });
    assert.equal(hello["output"].spaces.length, 1);
    assert.equal(hello["output"].active, ready["space"].id);
    assert.equal(hello["output"].signedIn, true);

    // a capability call goes through as the member; nothing off the extension's list goes anywhere
    assert.equal((await ext.rpc({ type: "invoke", capability: "vault.site_rules.list", input: {} }))["ok"], true);
    assert.equal(
      (await ext.rpc({ type: "invoke", capability: "records.delete", input: {} }))["error"].code,
      "not_allowed",
    );

    // signed out (the session row is revoked, as Settings, Sign-in and devices does): the very next call is refused by the Space
    d.db!.run(`UPDATE devices_session SET revoked_at = ? WHERE id = 'ses_noah01'`, Date.now());
    const after = await ext.rpc({ type: "invoke", capability: "vault.site_rules.list", input: {} });
    assert.equal(after["ok"], false);
    assert.match(after["error"].code, /^auth\./);
    // and a new socket with that session is not let in
    const again = await connect(d, member);
    assert.equal(await again.closed, 4401);
    ext.end();
  } finally {
    await d.stop();
  }
});

test("a login in the Vault fills a page field: the value is pushed down the socket that asked, before the answer, and never to another person's extension", async () => {
  const d = await boot();
  try {
    const owner = signIn(d, "usr_olivia", "olivia1");
    const member = signIn(d, "usr_noah", "noah01");

    // the owner keeps a login in a Shared folder (no personal key is needed for a Shared item)
    const folder = await call(d, owner, "vault.folders.create", {
      idempotencyKey: "cd-folder",
      name: "Tools",
      scope: "shared",
    });
    assert.equal(folder.status, 200, JSON.stringify(folder.error));
    const put = await call(d, owner, "vault.item.put", {
      idempotencyKey: "cd-item",
      folderId: folder.data.folder.id,
      name: "Fieldbook",
      kind: "login",
      fields: [
        { key: "url", value: "https://app.fieldbook.example" },
        { key: "username", value: "olivia@northwind.example" },
        { key: "password", value: "kept-in-the-vault-9", secret: true },
      ],
    });
    assert.equal(put.status, 200, JSON.stringify(put.error));

    const hers = await connect(d, owner);
    const his = await connect(d, member);
    await hers.next("ready", (m) => m["type"] === "ready");
    await his.next("ready", (m) => m["type"] === "ready");

    // what the popup and the field badge ask first: which logins fit this address (names, never values)
    const match = await hers.rpc({
      type: "invoke",
      capability: "vault.items.match",
      input: { url: "https://app.fieldbook.example" },
    });
    assert.equal(match["ok"], true, JSON.stringify(match["error"]));
    assert.equal(match["output"].items.length, 1);
    assert.equal(JSON.stringify(match["output"]).includes("kept-in-the-vault-9"), false);
    const item = match["output"].items[0].item;

    const used = await hers.rpc({
      type: "invoke",
      capability: "vault.use",
      input: { item: item.id, purpose: "fill app.fieldbook.example" },
    });
    assert.equal(used["ok"], true, JSON.stringify(used["error"]));

    // the fill: the extension mints a ref for one field and asks; the Vault's browser place sends the value down this socket
    const ref = "w1-00112233445566778899aabb";
    const filled = await hers.rpc({
      type: "invoke",
      capability: "vault.fill",
      input: { handle: `${used["output"].handle}.password`, target: { kind: "browser", ref } },
    });
    assert.equal(filled["ok"], true, JSON.stringify(filled["error"]));
    assert.equal(filled["output"].filled, true);
    assert.equal("value" in filled["output"], false, "the answer never carries the value");
    const push = hers.got.find((m) => m["type"] === "fill");
    assert.deepEqual(push, { type: "fill", ref, value: "kept-in-the-vault-9" });
    assert.ok(hers.got.indexOf(push!) < hers.got.indexOf(filled), "the value lands before the answer");
    assert.equal(hers.got.filter((m) => m["type"] === "fill").length, 1);
    assert.equal(JSON.stringify(his.got).includes("kept-in-the-vault-9"), false, "the other extension saw nothing");

    // a member of the Space may use a Shared login too: his fill goes down HIS socket, and hers sees nothing more
    const hisFill = await his.rpc({
      type: "invoke",
      capability: "vault.fill",
      input: {
        handle: `${used["output"].handle}.password`,
        target: { kind: "browser", ref: "w2-00112233445566778899aabb" },
      },
    });
    assert.equal(hisFill["output"].filled, true);
    assert.deepEqual(
      his.got.filter((m) => m["type"] === "fill"),
      [{ type: "fill", ref: "w2-00112233445566778899aabb", value: "kept-in-the-vault-9" }],
    );
    assert.equal(hers.got.filter((m) => m["type"] === "fill").length, 1);

    // a login only she can use (her own Mine folder): his extension gets the Vault's refusal and no value
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${owner}` },
      body: JSON.stringify({
        key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
      }),
    });
    assert.equal(unlock.status, 204);
    const own = await call(d, owner, "vault.folders.create", {
      idempotencyKey: "cd-mine",
      name: "Mine",
      scope: "mine",
    });
    assert.equal(own.status, 200, JSON.stringify(own.error));
    const secret = await call(d, owner, "vault.item.put", {
      idempotencyKey: "cd-item-2",
      folderId: own.data.folder.id,
      name: "Postbox",
      kind: "login",
      fields: [
        { key: "url", value: "https://mail.postbox.example" },
        { key: "username", value: "olivia@northwind.example" },
        { key: "password", value: "only-hers-4", secret: true },
      ],
    });
    assert.equal(secret.status, 200, JSON.stringify(secret.error));
    const stolen = await his.rpc({
      type: "invoke",
      capability: "vault.fill",
      input: {
        handle: `${secret.data.item.handle}.password`,
        target: { kind: "browser", ref: "w4-00112233445566778899aabb" },
      },
    });
    assert.equal(stolen["ok"], false, "the Vault refuses him");
    assert.equal(JSON.stringify(his.got).includes("only-hers-4"), false);
    assert.equal(his.got.filter((m) => m["type"] === "fill").length, 1);
    // and she fills it herself
    const own2 = await hers.rpc({
      type: "invoke",
      capability: "vault.fill",
      input: {
        handle: `${secret.data.item.handle}.password`,
        target: { kind: "browser", ref: "w5-00112233445566778899aabb" },
      },
    });
    assert.equal(own2["ok"], true, JSON.stringify(own2["error"]));
    assert.deepEqual(hers.got.filter((m) => m["type"] === "fill").at(-1), {
      type: "fill",
      ref: "w5-00112233445566778899aabb",
      value: "only-hers-4",
    });

    // over plain HTTP, with no extension waiting for the ref, the fill is refused in plain words, never a silent success
    const nobody = await call(d, owner, "vault.fill", {
      handle: `${used["output"].handle}.password`,
      target: { kind: "browser", ref: "w3-00112233445566778899aabb" },
    });
    assert.notEqual(nobody.status, 200);
    assert.match(String(nobody.error?.message), /No page in your Chrome is waiting/);
    hers.end();
    his.end();
  } finally {
    await d.stop();
  }
});
