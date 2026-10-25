// Star and Follow are independent per-person toggles (spec 2.23). The Starred synced entity keeps tombstones so devices converge.
// @reads ../migrations/0001_spaces.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import { MAYA, OMAR } from "../fixtures/seed.ts";

const CHAT = { type: "channel", id: "chn_general" } as const;
const FILE = { type: "file", id: "fil_plan" } as const;
const ACME = { type: "record", id: "rec_acme" } as const;

test("toggle a star on and off; the other person's stars are separate", async () => {
  const h = harness();
  const on = await handlers["stars.toggle"](h.as(MAYA), { resource: CHAT, on: true });
  assert.deepEqual(on, { starred: true, following: false });
  assert.deepEqual(await handlers["stars.toggle"](h.as(MAYA), { resource: CHAT, on: true }), { starred: true, following: false });
  assert.equal(h.events.filter((e) => e.name === "star.added").length, 1, "starring twice adds once");
  assert.deepEqual((await handlers["stars.list"](h.as(OMAR), {})).stars, []);
  assert.equal((await handlers["stars.list"](h.as(MAYA), {})).stars.length, 1);
  const off = await handlers["stars.toggle"](h.as(MAYA), { resource: CHAT, on: false });
  assert.deepEqual(off, { starred: false, following: false });
  assert.equal(h.events.filter((e) => e.name === "star.removed").length, 1);
  await handlers["stars.toggle"](h.as(MAYA), { resource: CHAT, on: false });
  assert.equal(h.events.filter((e) => e.name === "star.removed").length, 1, "unstarring twice removes once");
  assert.deepEqual((await handlers["stars.list"](h.as(MAYA), {})).stars, []);
});

test("a removed star keeps its row as a tombstone and comes back on the same row", async () => {
  const h = harness();
  await handlers["stars.toggle"](h.as(MAYA), { resource: FILE, on: true });
  const first = h.db.all(`SELECT id, version FROM spaces_star`)[0] as { id: string; version: number };
  assert.match(first.id, /^str_/);
  await handlers["stars.toggle"](h.as(MAYA), { resource: FILE, on: false });
  const gone = h.db.all(`SELECT id, deleted_at FROM spaces_star`)[0] as { id: string; deleted_at: number | null };
  assert.equal(gone.id, first.id);
  assert.notEqual(gone.deleted_at, null);
  await handlers["stars.toggle"](h.as(MAYA), { resource: FILE, on: true });
  const rows = h.db.all(`SELECT id, deleted_at, version FROM spaces_star`) as { id: string; deleted_at: number | null; version: number }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, first.id);
  assert.equal(rows[0]!.deleted_at, null);
  assert.equal(rows[0]!.version, 2);
});

test("star and follow are independent", async () => {
  const h = harness();
  const f = await handlers["follows.toggle"](h.as(MAYA), { resource: CHAT, on: true });
  assert.deepEqual(f, { following: true });
  assert.deepEqual((await handlers["stars.list"](h.as(MAYA), {})).stars, []);
  await handlers["stars.toggle"](h.as(MAYA), { resource: CHAT, on: true });
  await handlers["follows.toggle"](h.as(MAYA), { resource: CHAT, on: false });
  assert.equal((await handlers["stars.list"](h.as(MAYA), {})).stars.length, 1);
  assert.deepEqual((await handlers["follows.list"](h.as(MAYA), {})).follows, []);
  assert.deepEqual(h.events.map((e) => e.name), ["follow.added", "star.added", "follow.removed"]);
  assert.deepEqual(h.events[0]!.payload, { person: MAYA, resource: CHAT });
});

test("starring a person or company offers Also follow, on by default", async () => {
  const h = harness();
  const withKind = (kind?: "person" | "company") => ({ ...h.as(MAYA), resources: { describe: () => ({ title: "Acme", ...(kind ? { kind } : {}) }) } });
  assert.deepEqual(await handlers["stars.toggle"](withKind("company"), { resource: ACME, on: true }), { starred: true, following: true });
  assert.ok(h.events.some((e) => e.name === "follow.added"));
  // the person can turn it off at the moment of starring
  assert.deepEqual(await handlers["stars.toggle"](withKind("person"), { resource: { type: "record", id: "rec_bo" }, on: true, alsoFollow: false }), { starred: true, following: false });
  // an ordinary thing does not follow unless asked
  assert.deepEqual(await handlers["stars.toggle"](withKind(), { resource: FILE, on: true }), { starred: true, following: false });
  assert.deepEqual(await handlers["stars.toggle"](withKind(), { resource: CHAT, on: true, alsoFollow: true }), { starred: true, following: true });
  // unstarring leaves the follow alone
  assert.deepEqual(await handlers["stars.toggle"](withKind("company"), { resource: ACME, on: false }), { starred: false, following: true });
});

test("lists are newest first, filter by type, and use the host's titles; gone things drop out", async () => {
  const h = harness();
  const ctx = { ...h.as(MAYA), resources: { describe: (r: { id: string }) => (r.id === "fil_gone" ? null : { title: `Title of ${r.id}` }) } };
  await handlers["stars.toggle"](ctx, { resource: CHAT, on: true });
  h.advance(1000);
  await handlers["stars.toggle"](ctx, { resource: FILE, on: true });
  h.advance(1000);
  await handlers["stars.toggle"](ctx, { resource: { type: "file", id: "fil_gone" }, on: true });
  const all = (await handlers["stars.list"](ctx, {})).stars;
  assert.deepEqual(all.map((s) => s.resource.id), ["fil_plan", "chn_general"]);
  assert.equal(all[0]!.title, "Title of fil_plan");
  assert.deepEqual((await handlers["stars.list"](ctx, { type: "channel" })).stars.map((s) => s.resource.id), ["chn_general"]);
  // without a describe hook the id is the title
  assert.equal((await handlers["stars.list"](h.as(MAYA), {})).stars.find((s) => s.resource.id === "chn_general")!.title, "chn_general");
});

test("stars and follows need a signed-in person", async () => {
  const h = harness();
  for (const call of [
    handlers["stars.toggle"](h.anon, { resource: CHAT, on: true }),
    handlers["follows.toggle"](h.anon, { resource: CHAT, on: true }),
    handlers["stars.list"](h.anon, {}),
    handlers["follows.list"](h.anon, {}),
  ]) await assert.rejects(call, (e) => codeOf(e) === "auth.unauthenticated");
  assert.equal(h.db.all(`SELECT id FROM spaces_star`).length, 0);
});
