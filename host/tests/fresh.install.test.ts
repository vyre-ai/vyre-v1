// P-L7_23 (ruling 71): from an empty data directory the owner gets in. The host makes the Space once and prints a one-time claim link; the owner's client claims it with a username, a
// password and its own key bundle; then the owner signs in, works, invites a member who joins and acts. A second claim is refused and a restart keeps all of it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const COMPANY = {
  op: "type.create", type: "rt_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] },
};

type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("a fresh install: claim link, claim, sign in, work, invite a member who joins and acts; a second claim is refused; a restart keeps it all", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fresh-"));
  const boot = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh", "--space-name", "Fresh Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "fresh", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  let d = await boot();
  const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) as Json : {} };
  };
  const device = (name: string) => ({ deviceName: name, deviceClass: "desktop" });
  try {
    assert.ok(d.claim, "a fresh Space prints a claim link");
    assert.match(d.claim.url, /^https:\/\/team\.example\.com\/claim\/clm_[A-Za-z0-9_-]+/);
    assert.equal(fs.readFileSync(path.join(d.paths.logDir, "claim-link.txt"), "utf8").trim(), d.claim.url, "the setup log holds the same link");
    const code = decodeURIComponent(new URL(d.claim.url).pathname.split("/").pop() ?? "");
    // the link is a credential: no log file holds it, only the 0600 claim-link.txt does
    const logText = (): string => fs.readdirSync(d.paths.logDir).filter((f) => f !== "claim-link.txt").map((f) => fs.readFileSync(path.join(d.paths.logDir, f), "utf8")).join("\n");
    assert.ok(!logText().includes(code), "no log line holds the claim code");
    assert.equal(fs.statSync(path.join(d.paths.logDir, "claim-link.txt")).mode & 0o077, 0, "the link file is private to the owner of the process");

    assert.match(d.claim.url, /#fp=[0-9a-f]+&s=spc_fresh&n=Fresh%20Co$/, "the fragment carries the fingerprint, the Space id and the Space's name");
    const otherSpace = await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_other", username: "olivia", password: PASSWORD, ...device("Mac"), keys: KEYS });
    assert.equal(otherSpace.status, 422, "a link for a different Space is refused");
    assert.notEqual((await post(null, "/v1/identity/claim_owner", { code: "clm_not-the-code", spaceId: "spc_fresh", username: "olivia", password: PASSWORD, ...device("Mac"), keys: KEYS })).status, 200, "a wrong code is refused");
    const claimed = await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_fresh", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device("Olivia's Mac"), keys: KEYS });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.ok(!fs.existsSync(path.join(d.paths.logDir, "claim-link.txt")), "the claim spent, the file that held the link is gone");
    const signedIn = await post(null, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device("Olivia's laptop") });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    const owner = signedIn.body.data.session.token as string;
    const who = await post(owner, "/v1/identity/whoami", {});
    assert.equal(who.status, 200, JSON.stringify(who.body));

    // the support bundle and the logs never hold the code
    const bundle = await post(owner, "/v1/health/support_bundle", { idempotencyKey: "fresh-bundle" });
    assert.equal(bundle.status, 200, JSON.stringify(bundle.body));
    for (const row of d.db!.all("SELECT body FROM health_bundle") as { body: string }[]) assert.ok(!row.body.includes(code), "the support bundle does not hold the claim code");
    assert.ok(!logText().includes(code), "no log line holds the claim code after the claim either");

    // the owner works: a record type, a record
    assert.equal((await post(owner, "/v1/schema/apply", { idempotencyKey: "fresh-type", ops: [COMPANY] })).status, 200);
    const made = await post(owner, "/v1/records/create", { idempotencyKey: "fresh-rec", type: "rt_company", fields: { name: "Acme" } });
    assert.equal(made.status, 200, JSON.stringify(made.body));

    // the owner invites a member, who joins and acts
    const invite = await post(owner, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "fresh-invite" });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    const inviteCode = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(null, "/v1/members/accept", { code: inviteCode, username: "maya", password: PASSWORD, ...device("Maya's Mac"), keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const maya = joined.body.data.token as string;
    const acted = await post(maya, "/v1/records/create", { idempotencyKey: "fresh-maya", type: "rt_company", fields: { name: "Maya Ltd" } });
    assert.equal(acted.status, 200, `the member acts: ${JSON.stringify(acted.body)}`);
    assert.equal((await post(maya, "/v1/schema/apply", { idempotencyKey: "fresh-maya-type", ops: [COMPANY] })).status, 403, "and is not an owner");

    // the link works once
    const again = await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_fresh", username: "intruder", password: PASSWORD, ...device("Elsewhere"), keys: KEYS });
    assert.notEqual(again.status, 200, "a second claim is refused");

    // a restart keeps the Space, the owner and the member, and prints no new link
    await d.stop();
    d = await boot();
    assert.equal(d.claim, null, "a claimed Space has no claim link");
    const afterRestart = await post(owner, "/v1/records/query", { type: "rt_company" });
    assert.equal(afterRestart.status, 200, JSON.stringify(afterRestart.body));
    assert.ok(JSON.stringify(afterRestart.body.data).includes("Acme") && JSON.stringify(afterRestart.body.data).includes("Maya Ltd"));
    assert.equal((await post(maya, "/v1/records/create", { idempotencyKey: "fresh-maya-2", type: "rt_company", fields: { name: "Maya again" } })).status, 200, "the member still acts");
    assert.notEqual((await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_fresh", username: "intruder", password: PASSWORD, ...device("Elsewhere"), keys: KEYS })).status, 200, "the old link stays spent");
  } finally { await d.stop(); }
});

test("an unclaimed Space gets a new link at every start and only the newest works", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fresh2-"));
  const boot = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh2"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "fresh2", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const first = await boot();
  const oldLink = first.claim!.url;
  await first.stop();
  const d = await boot();
  try {
    assert.ok(d.claim && d.claim.url !== oldLink);
    assert.ok(!d.claim.url.includes("&n="), "a Space with no name of its own sends no name, so the page does not show an id as one");
    const claim = async (url: string): Promise<number> => (await fetch(`${d.url}/v1/identity/claim_owner`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""), spaceId: "spc_fresh2", username: "owner", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS }),
    })).status;
    assert.notEqual(await claim(oldLink), 200, "the older link stopped working");
    assert.equal(await claim(d.claim.url), 200, "the newest link works");
  } finally { await d.stop(); }
});
