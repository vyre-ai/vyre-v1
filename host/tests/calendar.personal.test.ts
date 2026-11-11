// Ruling 86: every person has one local Personal calendar, so nobody needs a Google or Microsoft connection to put an event in their day.
// Daemon level, real modules: the owner (at the first start and at the claim), a member who just joined, a person who already has one (no second), people who had none before this rule (made at start), and privacy.
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
type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("every person gets one private Personal calendar: owner, new member, existing people at start; an event is kept; no second calendar", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-personal-cal-"));
  const boot = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_pcal", "--space-name", "Cal Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "pcal", free: 80e9,
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
  const calendarsOf = async (token: string, scope: "mine" | "all" = "all"): Promise<{ id: string; personal: boolean; title: string }[]> => {
    const r = await post(token, "/v1/calendar/list_calendars", { scope });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data.calendars;
  };
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    // the host made the Space and its owner has a calendar before the claim: the claim then finds one and makes no second
    const claimed = await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_pcal", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device("Mac"), keys: KEYS });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const owner = (await post(null, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device("Laptop") })).body.data.session.token as string;
    const ownerPersonal = (await calendarsOf(owner)).filter((c) => c.personal);
    assert.equal(ownerPersonal.length, 1, "the owner has exactly one Personal calendar after the claim");

    // a member joins with nothing connected: a Personal calendar is there at once and an event on it is kept
    const invite = await post(owner, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "pcal-invite" });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    const inviteCode = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(null, "/v1/members/accept", { code: inviteCode, username: "maya", displayName: "Maya Chen", password: PASSWORD, ...device("Maya's Mac"), keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const maya = joined.body.data.token as string;
    const mayaPersonal = (await calendarsOf(maya)).filter((c) => c.personal);
    assert.equal(mayaPersonal.length, 1, "the member has a Personal calendar the moment they join");
    const when = Date.now() + 86_400_000;
    const made = await post(maya, "/v1/calendar/create_event", { idempotencyKey: "pcal-maya-event", calendarId: mayaPersonal[0]!.id, title: "Kickoff", startsAt: when, endsAt: when + 3_600_000 });
    assert.equal(made.status, 200, `the member's event is kept: ${JSON.stringify(made.body)}`);
    assert.equal(made.body.data.event.calendarId, mayaPersonal[0]!.id);
    const ownerEvent = await post(owner, "/v1/calendar/create_event", { idempotencyKey: "pcal-owner-event", calendarId: ownerPersonal[0]!.id, title: "Planning", startsAt: when, endsAt: when + 3_600_000 });
    assert.equal(ownerEvent.status, 200, `the owner's event is kept: ${JSON.stringify(ownerEvent.body)}`);

    // private to its person: the owner does not see the member's Personal calendar, and the member does not see the owner's
    assert.ok(!(await calendarsOf(owner)).some((c) => c.id === mayaPersonal[0]!.id), "the owner cannot see the member's Personal calendar");
    assert.ok(!(await calendarsOf(maya)).some((c) => c.id === ownerPersonal[0]!.id), "the member cannot see the owner's Personal calendar");
    const peek = await post(owner, "/v1/calendar/create_event", { idempotencyKey: "pcal-peek", calendarId: mayaPersonal[0]!.id, title: "Not yours", startsAt: when, endsAt: when + 3_600_000 });
    assert.notEqual(peek.status, 200, "nobody else can put an event on it");

    // a restart makes no second calendar for anyone
    await d.stop();
    d = await boot();
    assert.equal((await calendarsOf(owner)).filter((c) => c.personal).length, 1, "a restart leaves the owner with one");
    assert.equal((await calendarsOf(maya)).filter((c) => c.personal).length, 1, "a restart leaves the member with one");

    // a person who joined before this rule has none: the start makes theirs, and nothing else of theirs is touched
    d.db!.run(`DELETE FROM calendar_list WHERE "ownerId" = ?`, joined.body.data.personId);
    assert.equal((await calendarsOf(maya)).filter((c) => c.personal).length, 0, "(set up) the member has none");
    await d.stop();
    d = await boot();
    const after = (await calendarsOf(maya)).filter((c) => c.personal);
    assert.equal(after.length, 1, "the start gave the member a Personal calendar");
    const again = await post(maya, "/v1/calendar/create_event", { idempotencyKey: "pcal-maya-event-2", calendarId: after[0]!.id, title: "After the start", startsAt: when, endsAt: when + 3_600_000 });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal((await calendarsOf(owner)).filter((c) => c.personal).length, 1, "the owner still has exactly one");
  } finally { await d.stop(); }
});
