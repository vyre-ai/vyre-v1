// Vyre for Chrome on a Team Space: the server hosts the Space, this computer is a device with no Space of its own, and the person's own signed-in session (handed over by the app) is what the extension acts with.
// A member who is not the owner fills a Shared login through their device; a login they cannot see is refused; the owner's grants are never used.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const intervals = { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 };
const WHO: Record<string, string> = { "owner-session": "usr_olivia", "noah-session": "usr_noah", "tess-session": "usr_tess" };

function platformFor(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "chrome-team", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}

/** The Team Space's server: the seeded Space, with a session per person by bearer token. */
async function bootServer(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-team-srv-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), platform: platformFor(dir), fetch: caddyFetch, intervals,
    session: (headers) => {
      const id = WHO[String(headers.authorization ?? "").replace(/^Bearer /, "")];
      return id ? { space: CORE_SPACE, principal: { kind: "person", id }, device: "fixture" } : null;
    },
  });
}

/** A person's computer: the device role, no Space of its own. */
async function bootDevice(): Promise<Daemon> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-team-dev-"));
  return startDaemon({ config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"), platform: platformFor(dir), fetch: caddyFetch, intervals });
}

const asPerson = async (server: Daemon, who: string, cap: string, input: object): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${server.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${who}-session`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: `ct-${Math.random()}`, ...input }) });
  return { status: r.status, body: await r.json() };
};
const local = (d: Daemon, p: string, init: RequestInit = {}): Promise<Response> => fetch(`${d.url}${p}`, { ...init, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" } });
const rpc = async (d: Daemon, body: object): Promise<any> => (await (await fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: `r${Math.random()}`, ...body }) })).json());   // eslint-disable-line @typescript-eslint/no-explicit-any
const invoke = (d: Daemon, capability: string, input: object): Promise<any> => rpc(d, { type: "invoke", capability, input });   // eslint-disable-line @typescript-eslint/no-explicit-any

function events(d: Daemon): { lines: unknown[]; until(n: number): Promise<void>; close(): void } {
  const lines: unknown[] = [];
  let wake: (() => void) | null = null;
  const req = http.get(`${d.url}/chrome-bridge/v1/events`, { headers: { authorization: `Bearer ${d.token}` } }, (res) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      buf += c;
      let at: number;
      while ((at = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, at).trim(); buf = buf.slice(at + 1); if (l) lines.push(JSON.parse(l)); }
      wake?.();
    });
    res.on("error", () => {});
  });
  req.on("error", () => {});
  return { lines, until: async (n) => { for (let i = 0; i < 300 && lines.length < n; i++) await new Promise<void>((r) => { wake = r; setTimeout(r, 20); }); }, close: () => req.destroy() };
}

const link = (device: Daemon, server: Daemon, token: string): Promise<Response> =>
  local(device, "/local/chrome/spaces", { method: "POST", body: JSON.stringify({ id: CORE_SPACE, name: "Core", address: server.url, token: /-/.test(token) ? token : `${token}-session` }) });

const PASSWORD = "Team-portal-p4ss!";

test("chrome on a Team Space: a member fills a Shared login through their own device with their own grants, and a login they cannot see is refused", async () => {
  const server = await bootServer();
  const device = await bootDevice();
  const stream = events(device);
  try {
    for (let i = 0; i < 100 && device.chromeBridge.connected === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(device.chromeBridge.connected, 1, "the extension is connected to the device");
    // setup by the owner, over the server's HTTP door: a Shared folder with two logins, one shared with Noah and Tess at Use
    const folder = await asPerson(server, "owner", "vault.folders.create", { name: "Team logins", scope: "shared" });
    assert.equal(folder.status, 200, JSON.stringify(folder.body));
    const put = (name: string, url: string): Promise<{ status: number; body: any }> => asPerson(server, "owner", "vault.item.put", { folderId: folder.body.data.folder.id, name, kind: "login", fields: [{ key: "url", value: url }, { key: "username", value: "team@acme.test" }, { key: "password", value: name === "Team portal" ? PASSWORD : "owner-only-secret", secret: true }] });   // eslint-disable-line @typescript-eslint/no-explicit-any
    const shared = await put("Team portal", "https://portal.acme.test");
    const hidden = await put("Owner only", "https://ledger.acme.test");
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    for (const who of ["usr_noah", "usr_tess"]) {
      const g = await asPerson(server, "owner", "vault.share", { resource: { type: "vault_item", id: shared.body.data.item.id }, subject: { kind: "person", id: who }, level: "use" });
      assert.equal(g.status, 200, JSON.stringify(g.body));
    }

    // before the app hands over a session, the device has nothing to answer with
    assert.equal((await rpc(device, { type: "bridge", op: "hello", input: {} })).output.spaces.length, 0);
    assert.equal((await invoke(device, "vault.items.match", { url: "https://portal.acme.test" })).ok, false);
    // a bad hand-over is refused, and so is one without the device's own token
    assert.equal((await link(device, server, "x-y")).status, 422);
    assert.equal((await fetch(`${device.url}/local/chrome/spaces`, { method: "POST", body: "{}" })).status, 401);

    // Noah is signed in on this computer
    assert.equal((await link(device, server, "noah")).status, 200);
    const hello = await rpc(device, { type: "bridge", op: "hello", input: {} });
    assert.deepEqual(hello.output.spaces, [{ id: CORE_SPACE, name: "Core", webUrl: server.url }], "the Spaces this computer is signed in to");
    assert.equal(hello.output.active, CORE_SPACE);
    const match = await invoke(device, "vault.items.match", { url: "https://portal.acme.test" });
    assert.equal(match.ok, true, JSON.stringify(match));
    assert.deepEqual(match.output.items.map((x: { item: { name: string } }) => x.item.name), ["Team portal"]);
    assert.ok(!JSON.stringify(match).includes(PASSWORD));
    const used = await invoke(device, "vault.use", { item: shared.body.data.item.id, purpose: "fill portal.acme.test" });
    assert.equal(used.ok, true, JSON.stringify(used));
    const filled = await invoke(device, "vault.fill", { handle: `${used.output.handle}.password`, target: { kind: "browser", ref: "w1-abc123" } });
    assert.equal(filled.ok, true, JSON.stringify(filled));
    assert.equal(filled.output.filled, true);
    assert.ok(!JSON.stringify(filled).includes(PASSWORD), "the extension's reply carries no value");
    await stream.until(2);
    assert.ok(stream.lines.some((l) => JSON.stringify(l) === JSON.stringify({ type: "fill", ref: "w1-abc123", value: PASSWORD })), "the device pushed the value to the field for that ref");
    // the fill is Noah's: the owner's token was never used on this computer
    assert.equal((await rpc(device, { type: "bridge", op: "login.check", input: { origin: "https://portal.acme.test", username: "team@acme.test", password: PASSWORD, kind: "signin" } })).ok, true);

    // Tess: a temp with no role grant, shared only the first login. She is signed in on this computer instead.
    assert.equal((await link(device, server, "tess")).status, 200);
    const tess = await invoke(device, "vault.items.match", { url: "https://ledger.acme.test" });
    assert.ok(!tess.ok || tess.output.items.length === 0, "a login she cannot see is not offered");
    const refused = await invoke(device, "vault.use", { item: hidden.body.data.item.id, purpose: "fill ledger.acme.test" });
    assert.equal(refused.ok, false, "and asking for it by id is refused");
    const before = stream.lines.length;
    const direct = await invoke(device, "vault.fill", { handle: `#Owner_only.password`, target: { kind: "browser", ref: "w2-ffffff" } });
    assert.equal(direct.ok, false);
    assert.equal(stream.lines.length, before, "no value reached the page");
    assert.ok(!JSON.stringify([refused, direct]).includes("owner-only-secret"));
    const ok = await invoke(device, "vault.use", { item: shared.body.data.item.id, purpose: "fill portal.acme.test" });
    assert.equal(ok.ok, true, "what she was given still works");
    const tessFill = await invoke(device, "vault.fill", { handle: `${ok.output.handle}.password`, target: { kind: "browser", ref: "w3-eeeeee" } });
    assert.equal(tessFill.ok, true, JSON.stringify(tessFill));
    await stream.until(before + 1);
    assert.deepEqual(stream.lines[stream.lines.length - 1], { type: "fill", ref: "w3-eeeeee", value: PASSWORD }, "and her fill reaches her page");

    // an agent never gets this door, a session the Space no longer accepts says to sign in again, and signing out removes the Space
    assert.equal((await rpc(device, { type: "invoke", capability: "vault.items.match", agent: "agt_scout", input: { url: "https://x.test" } })).error.code, "not_allowed");
    assert.equal((await link(device, server, "revoked-token")).status, 200);
    assert.equal((await invoke(device, "vault.items.match", { url: "https://portal.acme.test" })).error.code, "signed_out");
    assert.equal((await local(device, `/local/chrome/spaces?id=${CORE_SPACE}`, { method: "DELETE" })).status, 200);
    assert.deepEqual((await rpc(device, { type: "bridge", op: "hello", input: {} })).output.spaces, []);
  } finally {
    stream.close();
    await device.stop();
    await server.stop();
  }
});
