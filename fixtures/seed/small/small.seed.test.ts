// P-L11_04: the `small` seed. Built through the capability API on a booted daemon, cached by hash, and a cache hit is a directory copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { routes } from "../../../generated/routes.ts";
import { PEOPLE } from "../core/index.ts";
import { SEED_TEST_PASSWORD } from "../../../testkit/src/seed-password.ts";
import { SMALL_TARGET } from "./recipe.ts";
import { bootSmall, contactRows, extraEvents, lastBuildTimings, startSeeded } from "./build.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "small-seed-test-"));
const cache = scratch();   // one template for the file: the first test builds it
let built: Awaited<ReturnType<typeof bootSmall>> | undefined;
const first = async (): Promise<Awaited<ReturnType<typeof bootSmall>>> => (built ??= await bootSmall({ cache, scratch: scratch() }));

const count = (dir: string, where: string): number => {
  const db = new DatabaseSync(path.join(dir, "events.db"), { readOnly: true });
  try { return (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`).get() as { n: number }).n; } finally { db.close(); }
};

test("the recipe: deterministic rows and the kernel extras the target needs", () => {
  assert.deepEqual(contactRows(), contactRows());
  assert.equal(new Set(contactRows().map((r) => r["email"])).size, SMALL_TARGET.records, "every match key is unique");
  const ev = extraEvents();
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length, "event ids are unique and fixed");
  assert.equal(ev.filter((e) => (e.payload as { type: string }).type === "channel").length, SMALL_TARGET.channels - 1, "one channel comes from core");
});

test("the first boot builds the small seed through capabilities; a second boot is a cache hit", async () => {
  const a = await first();
  try {
    assert.equal(a.hit, false, "the cache was empty");
    const b = await bootSmall({ cache, scratch: scratch() });
    assert.equal(b.hit, true);
    assert.equal(b.key, a.key);
    b.close();
    assert.equal(fs.readdirSync(cache).filter((f) => f.endsWith(".tmp")).length, 0, "no temp directory is left");
    console.log(`small seed cold build: ${JSON.stringify(lastBuildTimings())}`);
  } finally { /* kept for the next tests */ }
});

test("it holds the target: records, channels, agents, and the 6 people of core with every role", async () => {
  const s = await first();
  assert.ok(count(s.dir, "type = 'record.created'") >= SMALL_TARGET.records, "about 500 records");
  assert.equal(count(s.dir, "type = 'resource.created' AND json_extract(CAST(payload AS TEXT), '$.type') = 'channel'"), SMALL_TARGET.channels);
  assert.equal(count(s.dir, "type = 'principal.created' AND json_extract(CAST(payload AS TEXT), '$.kind') = 'agent'"), SMALL_TARGET.agents, "core's two plus every agent made through agents.create, each a principal from the moment it is made, and the kernel principals that stand in for what the module could not make");
  assert.equal(count(s.dir, "type = 'principal.created' AND json_extract(CAST(payload AS TEXT), '$.kind') = 'person'"), SMALL_TARGET.people);
  assert.deepEqual([...new Set(PEOPLE.map((p) => p.role))].sort(), ["admin", "manager", "member", "owner", "temp"]);
});

// Ruling 53 in the seed: agents are meant to come from agents.create. While the files module's tables are incomplete the builder records why in small.json and falls back to kernel principals.
test("every agent was made through agents.create", { todo: "P-L4_LIVE (L4): files migrations never create files_file, so agents.create answers 500 no such table: files_file" }, async () => {
  const s = await first();
  assert.deepEqual(s.gaps, []);
  assert.equal(s.agentsByModule, SMALL_TARGET.agents - 2);
});

test("a daemon boots on a copy and answers through the gateway: the contacts are there", async () => {
  const s = await bootSmall({ cache, scratch: scratch() });
  const d = await startSeeded(s.dir);
  try {
    const post = async (cap: string, body: unknown): Promise<{ status: number; data: any }> => {
      const r = routes.find((x) => x.cap === cap)!;
      const res = await fetch(`${d.url}${r.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
      const reply = (await res.json()) as { data?: unknown; error?: unknown };
      return { status: res.status, data: reply.data ?? reply.error ?? null };
    };
    assert.equal((await post("schema.types.list", {})).status, 200, "the schema module is read first: records answers no type contact until it has been (lazy built-in types)");
    const rows = await post("records.query", { type: "contact", limit: 500 });
    assert.equal(rows.status, 200, JSON.stringify(rows.data));
    const got = rows.data.total ?? (rows.data.rows as unknown[]).length;
    assert.ok(got >= SMALL_TARGET.records, `contact rows ${got}`);
  } finally { await d.stop(); s.close(); }
});

test("the access module knows the seed: View as and a folder share work on seeded ids", async () => {
  const s = await bootSmall({ cache, scratch: scratch() });
  const d = await startSeeded(s.dir);
  try {
    const post = async (cap: string, body: unknown): Promise<{ status: number; data: any }> => {
      const r = routes.find((x) => x.cap === cap)!;
      const res = await fetch(`${d.url}${r.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
      const reply = (await res.json()) as { data?: unknown; error?: unknown };
      return { status: res.status, data: reply.data ?? reply.error ?? null };
    };
    const view = await post("access.view_as", { person: "usr_noah" });
    assert.equal(view.status, 200, JSON.stringify(view.data));
    const who = await post("access.principals.get", { principal: { kind: "person", id: "usr_tess" } });
    assert.equal(who.status, 200, JSON.stringify(who.data));
    const shared = await post("access.share", { idempotencyKey: "small-share", resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_tess" }, level: "view" });
    assert.equal(shared.status, 200, JSON.stringify(shared.data));
  } finally { await d.stop(); s.close(); }
});

async function signInOlivia(): Promise<{ d: Awaited<ReturnType<typeof startSeeded>>; close(): Promise<void>; post(cap: string, body: unknown, token: string | null): Promise<{ status: number; data: any }>; sign: { status: number; data: any } }> {
  const s = await bootSmall({ cache, scratch: scratch() });
  const d = await startSeeded(s.dir);
  const post = async (cap: string, body: unknown, token: string | null): Promise<{ status: number; data: any }> => {
    const r = routes.find((x) => x.cap === cap)!;
    const res = await fetch(`${d.url}${r.path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const reply = (await res.json()) as { data?: unknown; error?: unknown };
    return { status: res.status, data: reply.data ?? reply.error ?? null };
  };
  const sign = await post("identity.sign_in", { username: "olivia", password: SEED_TEST_PASSWORD, deviceName: "Laptop", deviceClass: "desktop" }, null);
  return { d, post, sign, close: async () => { await d.stop(); s.close(); } };
}

test("a seeded person signs in with the test password and gets a key bundle; a wrong password is refused", { todo: "host (no packet yet): the daemon builds the gateway with no preAuth, so every anonymous or pending capability (identity.sign_in, identity.pair_redeem, members.accept, members.invites.preview) answers 401 auth.unauthenticated" }, async () => {
  const w = await signInOlivia();
  try {
    assert.equal(w.sign.status, 200, JSON.stringify(w.sign.data));
    assert.equal(w.sign.data.status, "ok");
    assert.ok(w.sign.data.keys?.personKeyByPassword, "the key bundle comes back");
    const bad = await w.post("identity.sign_in", { username: "olivia", password: "not the password", deviceName: "Laptop", deviceClass: "desktop" }, null);
    assert.ok(bad.status >= 400 && bad.status < 500, `a wrong password is refused: ${bad.status}`);
  } finally { await w.close(); }
});

test("her session pairs a device: identity.pair_create with the token sign-in returned", { todo: "P-SEC_05 (L7b): identity mints its own tokens and never writes devices_session or host_session_token, so the token sign-in returns is 401 at the gateway" }, async () => {
  const w = await signInOlivia();
  try {
    const pair = await w.post("identity.pair_create", { idempotencyKey: "small-pair", purpose: "app" }, w.sign.data.session.token);
    assert.equal(pair.status, 200, JSON.stringify(pair.data));
    assert.match(pair.data.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  } finally { await w.close(); }
});

test("the access module knows the seed: View as and a folder share work on seeded ids", async () => {
  const s = await bootSmall({ cache, scratch: scratch() });
  const d = await startSeeded(s.dir);
  try {
    const post = async (cap: string, body: unknown): Promise<{ status: number; data: any }> => {
      const r = routes.find((x) => x.cap === cap)!;
      const res = await fetch(`${d.url}${r.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
      const reply = (await res.json()) as { data?: unknown; error?: unknown };
      return { status: res.status, data: reply.data ?? reply.error ?? null };
    };
    const view = await post("access.view_as", { person: "usr_noah" });
    assert.equal(view.status, 200, JSON.stringify(view.data));
    const who = await post("access.principals.get", { principal: { kind: "person", id: "usr_tess" } });
    assert.equal(who.status, 200, JSON.stringify(who.data));
    const shared = await post("access.share", { idempotencyKey: "small-share", resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_tess" }, level: "view" });
    assert.equal(shared.status, 200, JSON.stringify(shared.data));
  } finally { await d.stop(); s.close(); }
});
