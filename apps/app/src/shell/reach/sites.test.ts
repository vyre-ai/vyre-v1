// Every place that opens something goes through reach (owner, 4 Nov). The runtime has one door, ShellRuntime.open (session.ts), and the door asks reach before it navigates. This test walks every
// call site in the app source and fails when one skips the door: a Console screen opened any other way, a navigation that does not come from the door, or a subject type the door cannot judge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "../../console/shell/nav.ts";
import { consolePageOf, judge, readOf } from "./target.ts";
import type { Judge } from "./target.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\/sample|sample\.tsx?$|\.d\.ts$/.test(p)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const read = (f: string): string => fs.readFileSync(f, "utf8");

test("the app has one door: only the session and the hub navigate, everything else calls rt.open", () => {
  const navigators = files.filter((f) => /\bo\.navigate\?\.?\(|\bnavigate\?\.\(/.test(read(f)) && !/session\/session\.ts$/.test(f));
  assert.deepEqual(navigators.map((f) => path.relative(SRC, f)), [], "nothing but session.ts calls the navigate option");
  const door = read(path.join(SRC, "shell/session/session.ts"));
  assert.ok(/judge\(t, judging\)/.test(door) && /needsJudging\(t\)/.test(door), "the door asks reach before it navigates");
  assert.ok(/o\.navigate\?\.\(place, targetHash\(t\)/.test(door) && (door.match(/o\.navigate\?\./g) ?? []).length === 1, "and there is one navigate call, behind that check");
});

const sites = files.flatMap((f) => [...read(f).matchAll(/\b(?:rt|runtime|session\.runtime)\.open\(\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => ({ f: path.relative(SRC, f), body: m[1]! })));

test("the walk finds the call sites (a sanity floor, so the test cannot pass by finding none)", () => {
  assert.ok(sites.length > 80, `found ${sites.length}`);
});

const judgeFor = (pages: ReadonlySet<string>, denied: ReadonlySet<string> = new Set()): Judge => ({
  viewer: () => ({ id: "usr_maya" }),
  consolePages: async () => pages,
  call: async (cap) => { if (denied.has(cap)) throw Object.assign(new Error("no"), { code: "permission.no_grant" }); return {}; },
  memo: new Map(),
});

test("every Console screen any call site opens is refused to a member and opened for an admin", async () => {
  const screens = new Set(sites.flatMap((s) => [...s.body.matchAll(/screen:\s*"(console\.[a-z-]+|company\.setup|google\.setup|microsoft\.setup)"/g)].map((m) => m[1]!)));
  assert.ok(screens.size >= 3, `found ${[...screens].join(", ")}`);
  const all = new Set(PAGES.map((p) => p.id));
  for (const screen of screens) {
    const t = { screen };
    if (consolePageOf(t) === null) continue;
    assert.equal((await judge(t, judgeFor(new Set()))).to, "none", `${screen} for a member`);
    assert.equal((await judge(t, judgeFor(all))).to, "open", `${screen} for an admin`);
  }
});

test("every kind of item a call site opens by subject is read before it opens, and a refused read stops the click", async () => {
  const types = new Set(sites.flatMap((s) => [...s.body.matchAll(/subject:\s*\{\s*type:\s*"([a-z_]+)"/g)].map((m) => m[1]!)));
  assert.ok(types.has("task") && types.has("record") && types.has("file") && types.has("thread"), `found ${[...types].join(", ")}`);
  // kinds that are judged: a read of their own
  const JUDGED = new Set(["thread", "chat", "task", "record", "contact", "file", "doc", "document", "project", "goal", "run", "automation", "agent", "channel", "folder"]);
  // kinds the door passes through because they are not a thing someone can be refused: the place's own listings and a person-less target
  const PASSED = new Set(["artifact", "call", "view", "note", "item", "vault", "journey", "mail", "email", "meeting", "event", "conversation", "message"]);
  for (const type of types) {
    assert.ok(JUDGED.has(type) || PASSED.has(type), `a subject type the door has no rule for: ${type}`);
    if (!JUDGED.has(type)) continue;
    const t = { subject: { type, id: "x1" }, args: { type: "contact" } };
    const r = readOf(t);
    assert.ok(r !== null, `${type} has a read`);
    const denied = await judge(t, judgeFor(new Set(), new Set([r!.cap])));
    assert.equal(denied.to, "none", `${type}: a refused read stops the click`);
    assert.equal((await judge(t, judgeFor(new Set()))).to, "open", `${type}: a read that answers lets it through`);
  }
});

test("a read that fails for another reason (the Space does not answer) lets the click through; the destination checks again", async () => {
  const j: Judge = { viewer: () => ({ id: "u" }), consolePages: async () => new Set(), call: async () => { throw Object.assign(new Error("net"), { code: "net.offline" }); }, memo: new Map() };
  assert.equal((await judge({ subject: { type: "task", id: "t1" } }, j)).to, "open");
});

test("an item opened once opens at once the next time, with no second read", async () => {
  let reads = 0;
  const j: Judge = { viewer: () => ({ id: "u" }), consolePages: async () => new Set(), call: async () => { reads++; return {}; }, memo: new Map() };
  await judge({ subject: { type: "task", id: "t1" } }, j);
  await judge({ subject: { type: "task", id: "t1" } }, j);
  assert.equal(reads, 1);
});
