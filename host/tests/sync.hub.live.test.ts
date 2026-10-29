// The production modern live hub on a booted daemon (rc.2): nothing is injected. The sync module registers its lazy hub factory through its seam, the daemon's WebSocket hands connections to it,
// and what a socket receives is exactly what pull would: row filters, hidden fields and the Space's own field classification. Real HTTP for the writes, real WebSockets for the readers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const REGISTRY_HASH = createHash("sha256").update(fs.readFileSync(new URL("../../generated/registry.json", import.meta.url))).digest("hex");
const RESTRICTED = "restricted-hub-value", CONFIDENTIAL = "confidential-hub-value", PLAIN = "plain-hub-value", HIDDEN = "hidden-hub-value";

const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
type Json = { status: number; data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

interface World { d: Daemon; owner: string; guest: string; guestId: string; ownerDevice: string; post(cap: string, input: unknown, token?: string): Promise<Json>; signIn(user: string, deviceName: string): Promise<{ token: string; deviceId: string }> }

/** A claimed Space with a real Owner and a real Guest, the way a person gets them: claim, sign in, invite, accept. Nothing is injected. */
async function world(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sync-hub-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_hub", "--address", "team.example.com"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "sync-hub", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (cap: string, input: unknown, token?: string): Promise<Json> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
    const j = (await r.json()) as { data?: unknown; error?: { code?: string } };
    return { status: r.status, data: j.data ?? j, ...(j.error ? { error: j.error } : {}) };
  };
  const signIn = async (user: string, deviceName: string) => {
    const r = await post("identity.sign_in", { username: user, password: PASSWORD, deviceName, deviceClass: "desktop" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { token: r.data.session.token as string, deviceId: (r.data.session.deviceId ?? r.data.session.device ?? "") as string };
  };
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  assert.equal((await post("identity.claim_owner", { code, spaceId: "spc_hub", username: "hubowner", displayName: "Hub Owner", password: PASSWORD, deviceName: "Owner laptop", deviceClass: "desktop", keys: KEYS })).status, 200);
  const owner = await signIn("hubowner", "Owner laptop");
  const roles = (await post("access.roles.list", {}, owner.token)).data.roles as { id: string; name: string }[];
  const invite = await post("members.invites.create", { role: roles.find((r) => r.name === "Guest")!.id, idempotencyKey: "hub-invite" }, owner.token);
  const joined = await post("members.accept", { code: decodeURIComponent(new URL(invite.data.link).pathname.split("/").pop() ?? ""), username: "hubguest", displayName: "Hub Guest", password: PASSWORD, keys: KEYS, deviceName: "Guest laptop", deviceClass: "desktop" });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  return { d, owner: owner.token, ownerDevice: owner.deviceId, guest: joined.data.token as string, guestId: joined.data.personId as string, post, signIn };
}

/** A device over Node's WebSocket, signed in with a real session token: frames are kept in order and can be waited for. */
async function socket(d: Daemon, token: string, deviceId: string, hash = REGISTRY_HASH, cursor = 0, epoch = 0) {
  const ws = new WebSocket(`${d.url.replace("http", "ws")}/sync/v1/ws?token=${encodeURIComponent(token)}&deviceClass=desktop`);
  const frames: Record<string, any>[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  let closed = false;
  ws.addEventListener("message", (m) => { frames.push(JSON.parse(String(m.data)) as Record<string, unknown>); });
  ws.addEventListener("close", () => { closed = true; });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("could not connect"))); });
  ws.send(JSON.stringify({ t: "hello", hello: { deviceId, deviceClass: "desktop", appVersion: "1.2.3", registryHash: hash, cursor, epoch, replica: { entities: {} } } }));
  const until = async (what: string, f: () => boolean, ms = 8000): Promise<void> => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise<void>((r) => setTimeout(r, 25))) if (f()) return;
    throw new Error(`never happened: ${what}. frames: ${JSON.stringify(frames).slice(0, 1500)}`);
  };
  return {
    frames, until, close: () => ws.close(), isClosed: () => closed,
    text: () => JSON.stringify(frames),
    hello: () => frames.find((f) => f["t"] === "hello_ok")?.["ok"] as { mode: string; epoch: number } | undefined,
    items: () => frames.filter((f) => f["t"] === "ev").flatMap((f) => f["items"] as { id: string; entity: string; fields: Record<string, unknown> }[]),
  };
}

const COMPANY = { op: "type.create", type: "rt_hubdeal", def: { title: "Hub deal", plural: "Hub deals", icon: "building", titleField: "name", fields: [
  { key: "name", type: "text", title: "Name", required: true },
  { key: "tax", type: "text", title: "Tax id", label: "restricted" },
  { key: "salary", type: "text", title: "Salary", label: "confidential" },
  { key: "secret", type: "text", title: "Secret" },
  { key: "memo", type: "text", title: "Memo" },
] } };
const fields = (name: string, extra: Record<string, string> = {}) => ({ name, tax: RESTRICTED, salary: CONFIDENTIAL, secret: HIDDEN, memo: PLAIN, ...extra });

/** The Space with its type, the Guest's grant (row filter on the name, one hidden field) and a first record each for the Guest to see and not see. */
async function seeded(w: World): Promise<void> {
  assert.equal((await w.post("schema.apply", { idempotencyKey: "hub-type", ops: [COMPANY] }, w.owner)).status, 200);
  const grant = await w.post("access.share", { resource: { type: "record_type", id: "rt_hubdeal" }, subject: { kind: "person", id: w.guestId }, level: "view", conditions: { hiddenFields: ["secret"], rowFilter: { op: "eq", field: "name", value: "Shared" } }, idempotencyKey: "hub-grant" }, w.owner);
  assert.equal(grant.status, 200, JSON.stringify(grant.data));
}
const create = (w: World, key: string, name: string, extra: Record<string, string> = {}) => w.post("records.create", { idempotencyKey: key, type: "rt_hubdeal", fields: fields(name, extra) }, w.owner);

test("the production daemon serves a modern live hub: hello_ok live, rows arrive as they are committed with no polling, Restricted never travels, an unknown build hash must resync", async () => {
  const w = await world();
  const open: Array<{ close(): void }> = [];
  try {
    await seeded(w);
    assert.equal((await create(w, "hub-a", "Shared")).status, 200);
    const olivia = await socket(w.d, w.owner, w.ownerDevice); open.push(olivia);
    await olivia.until("hello_ok", () => olivia.hello() !== undefined);
    assert.equal(olivia.hello()!.mode, "live", "the modern envelope with the production build hash is live");
    assert.equal(olivia.frames.find((f) => f["t"] === "hello_ok")?.["mode"], undefined, "it is the modern { ok } envelope, not the legacy top-level hello");
    await olivia.until("the first row", () => olivia.text().includes(PLAIN));

    // a row committed while the socket is open reaches it with nothing polling
    assert.equal((await create(w, "hub-b", "Second")).status, 200);
    await olivia.until("the live row", () => olivia.items().filter((i) => i.entity === "rt_hubdeal").length >= 2);
    const text = olivia.text();
    assert.ok(text.includes(CONFIDENTIAL) && text.includes(HIDDEN), "the Owner holds what she is cleared for");
    assert.ok(!text.includes(RESTRICTED), "Restricted never reaches a socket, even the Owner's");

    // a build the server does not know is told to resync and receives no data
    const stale = await socket(w.d, w.owner, w.ownerDevice, "0".repeat(64)); open.push(stale);
    await stale.until("hello_ok", () => stale.hello() !== undefined);
    assert.equal(stale.hello()!.mode, "resync");
    assert.ok(!stale.text().includes(PLAIN), "a client that must resync is sent nothing");
  } finally { for (const s of open) s.close(); await w.d.stop(); }
});

test("a real Guest receives only the rows its filter allows and never a hidden or classified field, live; revoking a device sends it a purge and closes its socket", async () => {
  const w = await world();
  const open: Array<{ close(): void }> = [];
  try {
    await seeded(w);
    assert.equal((await create(w, "hub-c", "Shared")).status, 200);
    assert.equal((await create(w, "hub-d", "Excluded", { memo: "excluded-hub-memo" })).status, 200);
    const guest = await socket(w.d, w.guest, "guest-device"); open.push(guest);
    await guest.until("hello_ok", () => guest.hello() !== undefined);
    assert.equal(guest.hello()!.mode, "live");
    await guest.until("the row it may see", () => guest.text().includes(PLAIN));
    assert.equal(guest.items().length, 1, "one row of the two");
    assert.equal((await create(w, "hub-e", "Shared", { memo: "live-guest-memo" })).status, 200);
    assert.equal((await create(w, "hub-f", "Excluded", { memo: "live-excluded-memo" })).status, 200);
    await guest.until("the live row it may see", () => guest.text().includes("live-guest-memo"));
    await new Promise<void>((r) => setTimeout(r, 300));
    for (const value of [RESTRICTED, CONFIDENTIAL, HIDDEN, "excluded-hub-memo", "live-excluded-memo"]) assert.ok(!guest.text().includes(value), `${value} never reached the Guest`);

    // a second device of the Owner is revoked: its socket gets a purge and closes, and signing back in on that device learns nothing
    const phone = await w.signIn("hubowner", "Owner phone");
    const socketPhone = await socket(w.d, phone.token, phone.deviceId); open.push(socketPhone);
    await socketPhone.until("hello_ok", () => socketPhone.hello() !== undefined);
    const bump = await w.post("sync.epoch.bump", { personId: (await w.post("identity.whoami", {}, w.owner)).data.principal.id, reason: "device_revoked", deviceId: phone.deviceId }, w.owner);
    assert.equal(bump.status, 200, JSON.stringify(bump.data));
    await socketPhone.until("a purge frame", () => socketPhone.frames.some((f) => f["t"] === "purge"));
    await socketPhone.until("the socket closed", () => socketPhone.isClosed());
    const again = await socket(w.d, phone.token, phone.deviceId); open.push(again);
    await again.until("a purge, not a hello_ok", () => again.frames.some((f) => f["t"] === "purge"));
    assert.equal(again.hello(), undefined, "a revoked device learns nothing: no hello_ok");
  } finally { for (const s of open) s.close(); await w.d.stop(); }
});

test("raising a field's classification while a device is connected purges it before any further data, and the daemon stops cleanly with sockets open", async () => {
  const w = await world();
  try {
    await seeded(w);
    assert.equal((await create(w, "hub-g", "Shared")).status, 200);
    const olivia = await socket(w.d, w.owner, w.ownerDevice);
    await olivia.until("the row", () => olivia.text().includes(CONFIDENTIAL));
    const raised = await w.post("schema.set_label", { type: "rt_hubdeal", field: "salary", label: "restricted" }, w.owner);
    assert.equal(raised.status, 200, JSON.stringify(raised.data));
    assert.equal((await create(w, "hub-h", "Shared", { salary: "after-raise-value" })).status, 200);
    await olivia.until("a purge frame", () => olivia.frames.some((f) => f["t"] === "purge"));
    assert.ok(!olivia.text().includes("after-raise-value"), "nothing committed after the raise reached the device that cached the old classification");
  } finally { await w.d.stop(); }
});

test("a device that drops and reconnects with its cursor is sent exactly what it missed: no loss, no row applied twice", async () => {
  const w = await world();
  const open: Array<{ close(): void }> = [];
  try {
    await seeded(w);
    const name = (i: { fields: Record<string, any> }): string => String((i.fields["name"] as { v: unknown }).v);   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await create(w, "rc-a", "Alpha")).status, 200);
    const first = await socket(w.d, w.owner, w.ownerDevice); open.push(first);
    await first.until("Alpha", () => first.items().some((i) => name(i) === "Alpha"));
    assert.equal((await create(w, "rc-b", "Bravo")).status, 200);
    await first.until("Bravo", () => first.items().some((i) => name(i) === "Bravo"));
    const cursor = Math.max(...first.frames.filter((f) => f["t"] === "ev").flatMap((f) => (f["items"] as { seq: number }[]).map((i) => i.seq)));
    const epoch = first.hello()!.epoch;

    // the network drops: the socket goes, and two rows are committed while the device is away
    first.close();
    await first.until("closed", () => first.isClosed());
    assert.equal((await create(w, "rc-c", "Charlie")).status, 200);
    assert.equal((await create(w, "rc-d", "Delta")).status, 200);

    const back = await socket(w.d, w.owner, w.ownerDevice, REGISTRY_HASH, cursor, epoch); open.push(back);
    await back.until("hello_ok", () => back.hello() !== undefined);
    assert.equal(back.hello()!.mode, "live");
    await back.until("the missed rows", () => ["Charlie", "Delta"].every((n) => back.items().some((i) => name(i) === n)));
    assert.deepEqual(back.items().map(name).sort(), ["Charlie", "Delta"], "exactly the missed rows: nothing lost, nothing sent again");

    assert.equal((await create(w, "rc-e", "Echo")).status, 200);
    await back.until("Echo", () => back.items().some((i) => name(i) === "Echo"));
    assert.deepEqual(back.items().map(name).sort(), ["Charlie", "Delta", "Echo"], "and one live row, once");
  } finally { for (const s of open) s.close(); await w.d.stop(); }
});

test("a sync session is told that something changed when the event is not a synced row, with no payload, so screens built on module tables still refresh", async () => {
  const w = await world();
  const open: Array<{ close(): void }> = [];
  try {
    const guest = await socket(w.d, w.guest, "guest-tick"); open.push(guest);
    await guest.until("hello_ok", () => guest.hello() !== undefined);
    const made = await w.post("agents.create", { name: "Tick agent", role: "Watches", idempotencyKey: "hub-tick-agent" }, w.owner);
    assert.equal(made.status, 200, JSON.stringify(made.data));
    await guest.until("a changed tick", () => guest.frames.some((f) => f["t"] === "changed"));
    const tick = guest.frames.find((f) => f["t"] === "changed")!;
    assert.deepEqual(Object.keys(tick).sort(), ["seq", "t"], "the tick carries only the event number");
    assert.ok(!guest.text().includes("Tick agent"), "and nothing of the event itself");
    assert.ok(!guest.frames.some((f) => f["t"] === "ev"), "no raw event frame reaches a sync session");
  } finally { for (const s of open) s.close(); await w.d.stop(); }
});
