// @tsx
// Pointers, expressions, query binding, status, keys and the screens index.
import test from "node:test";
import assert from "node:assert/strict";
import { evalExpr, interpolate, resolveInputMap, resolvePointer, type Scope } from "../runtime/pointer.ts";
import { createQuerySet, deriveStatus, queryData } from "../runtime/queries.ts";
import { matchCombo, parseCombo } from "../runtime/keys.ts";
import { createScreenRegistry } from "../runtime/registry.ts";
import { previewDef } from "../runtime/preview.ts";
import { screens } from "../../../../generated/screens.ts";
import { isScreenPlace, type KitSlot, type ScreenPlace } from "../types.ts";
import { fakeEnv, listDef, people } from "./fakes.tsx";

const scope: Scope = { queries: { people, n: 0 }, state: { q: "ma", flag: true, kind: "lead" }, row: people[0], index: 0 };

test("pointers read queries, state and the row; a missing step is undefined", () => {
  assert.equal(resolvePointer(scope, "/row/name"), "Maya Chen");
  assert.equal(resolvePointer(scope, "/queries/people/1/company"), "Harbor Legal");
  assert.equal(resolvePointer(scope, "/state/q"), "ma");
  assert.equal(resolvePointer(scope, "/state/nope/deeper"), undefined);
  assert.equal(resolvePointer(scope, "state/q"), undefined);
  assert.deepEqual(resolveInputMap({ q: "/state/q", id: "/row/id", gone: "/state/missing" }, scope), { q: "ma", id: "p1" });
  assert.equal(interpolate("{/row/name} at {/row/company}{/state/missing}", scope), "Maya Chen at Northwind");
});

test("expressions: truthiness, not, empty, equality, and, or", () => {
  const t = (e: string) => evalExpr(e, scope);
  assert.ok(t("/state/flag"));
  assert.ok(!t("!/state/flag"));
  assert.ok(t("/queries/people"));
  assert.ok(!t("empty(/queries/people)"));
  assert.ok(t("empty(/state/missing)"));
  assert.ok(t("/state/kind == 'lead'"));
  assert.ok(t("/state/kind != 'client'"));
  assert.ok(t("/queries/n == 0"));
  assert.ok(t("/state/flag && /state/kind == 'lead'"));
  assert.ok(!t("/state/flag && /state/kind == 'client'"));
  assert.ok(t("/state/missing || /state/flag"));
  assert.ok(evalExpr(undefined, scope));
  assert.ok(!t("garbage"), "an expression it cannot read is false");
});

test("the query set gives one stable snapshot until a query changes", () => {
  let data: unknown;
  const listeners = new Set<() => void>();
  const env = fakeEnv({
    hooks: {
      query: () => ({
        subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
        getSnapshot: () => (data === undefined ? { status: "loading" as const } : { status: "ready" as const, data }),
      }),
    },
  });
  const set = createQuerySet(listDef, env, {});
  const a = set.getSnapshot();
  assert.equal(set.getSnapshot(), a, "same object with no change");
  assert.equal(deriveStatus(listDef, a, true), "loading");
  const off = set.subscribe(() => {});
  assert.equal(listeners.size, 1);
  data = people;
  const b = set.getSnapshot();
  assert.notEqual(b, a);
  assert.equal(set.getSnapshot(), b);
  assert.equal(deriveStatus(listDef, b, true), "ready");
  assert.deepEqual(queryData(b), { people });
  off();
  assert.equal(listeners.size, 0);
});

test("status: error wins, offline needs a server read, empty is the first query with no rows", () => {
  const ready = (d: unknown) => ({ people: { status: "ready" as const, data: d } });
  assert.equal(deriveStatus(listDef, ready([]), true), "empty");
  assert.equal(deriveStatus(listDef, ready({ items: [] }), true), "empty");
  assert.equal(deriveStatus(listDef, ready(people), true), "ready");
  assert.equal(deriveStatus(listDef, ready([]), false), "empty", "a local read still answers offline");
  assert.equal(deriveStatus(listDef, { people: { status: "error", error: "x" } }, true), "error");
  const remote = { ...listDef, queries: { people: { ...listDef.queries.people!, live: false } } };
  assert.equal(deriveStatus(remote, { people: { status: "loading" } }, false), "offline");
  assert.equal(deriveStatus(remote, { people: { status: "error", error: "x" } }, false), "error");
});

test("a one-shot query reads through env.read only while online, and errors without it", async () => {
  const remote = { ...listDef, queries: { people: { ...listDef.queries.people!, live: false } } };
  const calls: unknown[] = [];
  const env = fakeEnv({ read: async (cap, input) => { calls.push([cap, input]); return people; } });
  const set = createQuerySet(remote, env, { q: "ma" });
  set.subscribe(() => {});
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, [["records.list", { q: "ma" }]]);
  assert.equal(set.getSnapshot().people?.status, "ready");
  const none = createQuerySet(remote, fakeEnv(), {});
  assert.equal(none.getSnapshot().people?.status, "error");
  const offline = fakeEnv({ online: false, read: async () => { throw new Error("must not be called"); } });
  createQuerySet(remote, offline, {}).subscribe(() => {});
});

test("key combos: mod is Command on a Mac and Control elsewhere", () => {
  const ev = (key: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  assert.ok(matchCombo(parseCombo("mod+k"), ev("k", { metaKey: true }), true));
  assert.ok(!matchCombo(parseCombo("mod+k"), ev("k", { ctrlKey: true }), true));
  assert.ok(matchCombo(parseCombo("mod+k"), ev("k", { ctrlKey: true }), false));
  assert.ok(matchCombo(parseCombo("Enter"), ev("Enter"), true));
  assert.ok(!matchCombo(parseCombo("Enter"), ev("Enter", { shiftKey: true }), true));
  assert.ok(matchCombo(parseCombo("shift+Delete"), ev("Delete", { shiftKey: true }), false));
  assert.ok(matchCombo(parseCombo("down"), ev("ArrowDown"), false));
});

test("the screens index holds every generated screen by id, place and slot", () => {
  // The contract names a "join" place (join.accept, join.checklist, join.reset, join.sign-in) that ScreenPlace in
  // ui/src/kit/types.ts does not list yet. Those four are the only ones left out here; a new gap fails this test.
  const known = screens.filter((s) => isScreenPlace(s.place));
  assert.deepEqual(screens.filter((s) => !isScreenPlace(s.place)).map((s) => s.id).sort(), ["join.accept", "join.checklist", "join.reset", "join.sign-in"]);
  const registry = createScreenRegistry(known.map(previewDef));
  assert.equal(registry.all().length, known.length);
  assert.deepEqual(registry.diffAgainst(known.map((s) => s.id)), { missing: [], extra: [] });
  assert.ok(registry.diffAgainst(["access.checker", "ghost.screen"]).extra.includes("access.grants"));
  assert.deepEqual(registry.diffAgainst(["ghost.screen"]).missing, ["ghost.screen"]);
  for (const s of known) assert.ok(registry.forSlot(s.place as ScreenPlace, s.slot as KitSlot).some((d) => d.id === s.id), s.id);
  assert.throws(() => registry.register(previewDef(known[0]!)), /already registered/);
  assert.throws(() => registry.register({ id: "", place: "home", slot: "main" } as never), /not a Kit screen/);
});
