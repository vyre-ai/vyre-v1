// P-GF_01: a removed member is refused at sign-in by every route, and the sessions they had stop working. Golden 9 found identity.sign_in answering 200 after members.remove.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

test("a removed member cannot sign in again, their old session token answers 401, and a suspended member is refused too until reactivated", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-removed-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "removed-signin", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const owner = d.token;   // the local admin token acts as the Space owner
  try {
    const invite = await post(owner, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "removed-invite" });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    const code = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(null, "/v1/members/accept", { code, username: "leaver", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const person = joined.body.data.personId as string, old = joined.body.data.token as string;
    const signIn = () => post(null, "/v1/identity/sign_in", { username: "leaver", password: PASSWORD, deviceName: "Phone", deviceClass: "phone" });
    assert.equal((await post(old, "/v1/identity/whoami", {})).status, 200, "a member's session works");
    assert.equal((await signIn()).status, 200, "and they can sign in again");

    // suspended: refused, and the way back is reactivation
    assert.equal((await post(owner, "/v1/members/suspend", { personId: person })).status, 200);
    assert.notEqual((await signIn()).status, 200, "a suspended member cannot sign in");
    assert.equal((await post(old, "/v1/identity/whoami", {})).status, 401, "and their live token stops working at once");
    assert.equal((await post(owner, "/v1/members/reactivate", { personId: person })).status, 200);
    assert.equal((await post(old, "/v1/identity/whoami", {})).status, 200, "reactivated, the same token works again");
    const back = await signIn();
    assert.equal(back.status, 200, JSON.stringify(back.body));

    // removed: no sign-in, no old session
    const removed = await post(owner, "/v1/members/remove", { personId: person, plan: [] });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const refused = await signIn();
    assert.notEqual(refused.status, 200, "a removed member cannot sign in");
    assert.equal(refused.body.error?.code, "auth.bad_credentials");
    assert.equal((await post(old, "/v1/identity/whoami", {})).status, 401, "their old session token is refused");
    assert.equal((await post(back.body.data.session.token, "/v1/identity/whoami", {})).status, 401, "and so is the one from their later sign-in");
  } finally { await d.stop(); }
});
