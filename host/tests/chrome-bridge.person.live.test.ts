// Vyre for Chrome acts as the person signed in to the Vyre app on this computer, never as the owner (lib/chrome-app.ts, routes/team-links.ts): a booted daemon is handed two people's own
// sessions the way the desktop shell hands them over, and the bridge acts as whichever Space is picked in the extension, through the Space's gateway, with that person's access.
// A member's extension cannot use the owner's powers; signing out takes the Space away; with nobody signed in every call is refused.
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
import { issueSessionToken } from "../src/daemon/session.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** This repo with the devices module live (device sessions are its rows), as revoke.e2e.test.ts builds it. */
function codeRootWithDevicesLive(): string {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-person-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const dev = list.modules.find((m) => m.id === "devices");
  assert.ok(dev);
  dev.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-person-data-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("the extension acts as the picked Space's signed-in person through the gateway, a member never gets the owner's powers, and signed out it refuses", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithDevicesLive(),
    platform: fakePlatform({ os: "linux", hostname: "chrome-person", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const now = Date.now();
    /** A person signed in on a device of their own, as the devices module records it, and the session token their app holds. */
    const signIn = (person: string, n: string): string => {
      d.db!.run(`INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, `dev_${n}`, person, n, now, now);
      d.db!.run(`INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, `ses_${n}`, person, `dev_${n}`, now, now);
      return issueSessionToken(d.db!, `ses_${n}`);
    };
    const owner = signIn("usr_olivia", "olivia1"), member = signIn("usr_noah", "noah01");
    const rpc = async (body: unknown) => (await fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ id: "r", ...body as object }) })).json();
    /** The desktop shell handing a session over (chrome.rs link_chrome_space), on loopback with the daemon's own key, which only the shell holds. */
    const link = (id: string, token: string) => fetch(`${d.url}/local/chrome/spaces`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ id, name: id, address: d.url, token, compute: false }) });
    const unlink = (id: string) => fetch(`${d.url}/local/chrome/spaces?id=${id}`, { method: "DELETE", headers: { authorization: `Bearer ${d.token}` } });

    // nobody signed in: refused, and the daemon's own admin token does not stand in for anyone
    assert.equal((await rpc({ type: "bridge", op: "agents.list", input: {} })).error.code, "signed_out");

    assert.equal((await link("spc_owner", owner)).status, 204);
    assert.equal((await link("spc_member", member)).status, 204);
    const hello = await rpc({ type: "bridge", op: "hello", input: {} });
    assert.deepEqual(hello.output.spaces.map((s: { id: string }) => s.id), ["spc_owner", "spc_member"]);
    assert.equal(hello.output.active, "spc_member", "the newest sign-in is picked first");
    assert.equal(d.teamLinks().length, 0, "sessions for the extension only are never dialled for chats");

    // Whose agents the extension sees says who it acts as: Scout is the member's own agent (fixtures/seed/core/recipe.ts).
    const mine = async () => ((await rpc({ type: "bridge", op: "agents.list", input: { section: "personal" } })).output?.agents ?? []).map((a: { name: string }) => a.name);

    // the member's Space: everything runs as the member, with the member's roles
    assert.deepEqual(await mine(), ["Scout"]);
    assert.equal((await rpc({ type: "invoke", capability: "vault.site_rules.list", input: {} })).ok, true, "a member's own call goes through as the member");
    assert.equal((await rpc({ type: "invoke", capability: "records.delete", input: {} })).error.code, "not_allowed", "nothing off the extension's list, for anyone");

    // pick the owner's Space in the extension: now the owner, whose own agents do not include Scout
    assert.equal((await rpc({ type: "bridge", op: "space.select", input: { id: "spc_owner" } })).ok, true);
    assert.deepEqual(await mine(), []);
    assert.equal((await rpc({ type: "bridge", op: "space.select", input: { id: "spc_nobody" } })).error.code, "validation.not_found", "only a Space someone is signed in to here");

    // the owner signs out on this computer: back to the member, never left acting as the owner
    assert.equal((await unlink("spc_owner")).status, 204);
    assert.deepEqual(await mine(), ["Scout"]);

    // a session the Space no longer knows is refused by the Space, not upgraded by the bridge
    await link("spc_member", "vst_" + "0".repeat(64));
    const stale = await rpc({ type: "invoke", capability: "vault.site_rules.list", input: {} });
    assert.equal(stale.ok, false);
    assert.match(stale.error.code, /^auth\./);

    await unlink("spc_member");
    assert.equal((await rpc({ type: "invoke", capability: "vault.site_rules.list", input: {} })).error.code, "signed_out");
  } finally { await d.stop(); }
});
