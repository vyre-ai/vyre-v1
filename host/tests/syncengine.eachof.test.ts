// A per-parent list through the sync engine's remote store: one read of the parent list for the ids, then the child list once for each parent (sorted, so a place kept between passes still
// means the same thing), inner paging inside a parent, empty parents skipped, every row stamped with /_parent, and a place that names a parent that has since gone moves on to the next one.
import test from "node:test";
import assert from "node:assert/strict";
import { namesFor, remoteStore } from "../src/daemon/syncengine.ts";

type Call = { cap: string; action: string; input: Record<string, unknown> };

function world(parents: string[], kids: Record<string, string[][]>) {
  const calls: Call[] = [];
  const ctx = {
    trace: { traceId: "t1" },
    call: async (cap: string, a: { action: string; input?: Record<string, unknown> }): Promise<unknown> => {
      const input = (a.input ?? {}) as Record<string, unknown>;
      calls.push({ cap, action: a.action, input });
      if (a.action === "list_matters")
        return { output: { results: parents.map((p) => ({ id: p, properties: { name: "m" } })) } };
      if (a.action === "list_contacts" || a.action === "list_contacts_after") {
        const pages = kids[String(input["parent"])];
        if (!pages) throw new Error("no such parent");
        const i = a.action === "list_contacts" ? 0 : Number(input["after"]);
        const rows = pages[i] ?? [];
        return {
          output: {
            results: rows.map((id) => ({ id, properties: { "/full_name": "x" } })),
            ...(i + 1 < pages.length ? { next: String(i + 1) } : {}),
          },
        };
      }
      throw new Error("unexpected " + a.action);
    },
  };
  return { ctx, calls };
}
const OBJECTS = {
  matters: { list: "list_matters", listAfter: "list_matters_after" },
  contacts: { list: "list_contacts", listAfter: "list_contacts_after", eachOf: { remote: "matters", scoped: false } },
};
const store = (ctx: unknown) =>
  remoteStore(ctx as never, { connector: "crm_intake", connectionId: "con_1", remote: "contacts" }, OBJECTS);

async function drain(
  s: ReturnType<typeof store>,
  from?: string,
): Promise<{ ids: string[]; parents: string[]; tokens: string[] }> {
  const ids: string[] = [];
  const parents: string[] = [];
  const tokens: string[] = [];
  let after = from;
  for (let i = 0; i < 50; i++) {
    const g = await s.page(after);
    for (const r of g.rows) {
      ids.push(r.id);
      parents.push(String(r.data["/_parent"]));
    }
    if (g.next === undefined) break;
    tokens.push(g.next);
    after = g.next;
  }
  return { ids, parents, tokens };
}

test("namesFor reads eachOf, and an object without it has none", () => {
  assert.deepEqual(namesFor(OBJECTS, "contacts").eachOf, { remote: "matters", scoped: false });
  assert.equal(namesFor(OBJECTS, "matters").eachOf, undefined);
  assert.equal(namesFor({ contacts: { list: "l", eachOf: { remote: "" } } }, "contacts").eachOf, undefined);
});

test("every parent is read in order, inner pages are followed, empty parents are passed over, rows carry /_parent", async () => {
  const { ctx, calls } = world(["mB", "mA", "mC", "mD"], {
    mA: [["a1", "a2"], ["a3"]],
    mB: [[]],
    mC: [["c1"]],
    mD: [[]],
  });
  const got = await drain(store(ctx));
  assert.deepEqual(got.ids, ["a1", "a2", "a3", "c1"]);
  assert.deepEqual(got.parents, ["mA", "mA", "mA", "mC"]);
  // the parent list is read once, and as a read (it does not wait at the Gate)
  const parentReads = calls.filter((c) => c.action === "list_matters");
  assert.equal(parentReads.length, 1);
  assert.equal(parentReads[0]!.cap, "connectors.read");
  // the child list: first page of a parent without `after`, further pages with it
  const kid = calls
    .filter((c) => c.action.startsWith("list_contacts"))
    .map((c) => `${c.input["parent"]}:${c.input["after"] ?? "-"}`);
  assert.deepEqual(kid, ["mA:-", "mA:1", "mB:-", "mC:-", "mD:-"]);
});

test("a place kept between passes resumes where it was, in a fresh store", async () => {
  const kids = { mA: [["a1"], ["a2"]], mB: [["b1"]], mC: [["c1"]] };
  const first = world(["mA", "mB", "mC"], kids);
  const s1 = store(first.ctx);
  const p1 = await s1.page();
  assert.deepEqual(
    p1.rows.map((r) => r.id),
    ["a1"],
  );
  const rest = await drain(store(world(["mA", "mB", "mC"], kids).ctx), p1.next);
  assert.deepEqual(rest.ids, ["a2", "b1", "c1"]);
});

test("a parent that is gone since the place was kept: the pass goes on with the next one, nothing is repeated", async () => {
  const w = world(["mA", "mC"], { mA: [["a1"]], mC: [["c1"]] });
  const token = JSON.stringify({ p: "mB", c: "3" }); // kept while mB existed, now gone
  const got = await drain(store(w.ctx), token);
  assert.deepEqual(got.ids, ["c1"]);
  const none = await drain(store(world(["mA"], { mA: [["a1"]] }).ctx), JSON.stringify({ p: "mZ" }));
  assert.deepEqual(none.ids, [], "no later parent: the pass ends");
});

test("a long run of parents with nothing under them is not one endless call: a page comes back empty with a place to go on from", async () => {
  const many = Array.from({ length: 95 }, (_, i) => `m${String(i).padStart(3, "0")}`);
  const kids: Record<string, string[][]> = Object.fromEntries(many.map((m) => [m, [[]]]));
  kids["m094"] = [["last"]];
  const w = world(many, kids);
  const s = store(w.ctx);
  const first = await s.page();
  assert.deepEqual(first.rows, []);
  assert.ok(first.next, "a place to go on from");
  assert.equal(w.calls.filter((c) => c.action === "list_contacts").length, 40, "at most 40 parents for one page");
  const got = await drain(store(world(many, kids).ctx));
  assert.deepEqual(got.ids, ["last"]);
  // the whole listing (a push that looks a record up) reaches it too, through the empty pages
  const all = await store(world(many, kids).ctx).query("contacts", {} as never);
  assert.deepEqual(
    all.rows.map((r) => r.id),
    ["last"],
  );
});

test("by default the same child id under two parents is two rows, the id carries its parent; scoped: false keeps the app's own id", async () => {
  const objects = {
    ...OBJECTS,
    contacts: { list: "list_contacts", listAfter: "list_contacts_after", eachOf: { remote: "matters" } },
  };
  const mk = () => world(["mA", "mB"], { mA: [["role1"]], mB: [["role1"]] });
  const s = remoteStore(
    mk().ctx as never,
    { connector: "crm_intake", connectionId: "con_1", remote: "contacts" },
    objects,
  );
  const got = await drain(s);
  assert.deepEqual(got.ids, ["mA/role1", "mB/role1"]);
  assert.deepEqual(got.parents, ["mA", "mB"]);
  const g = await drain(store(mk().ctx));
  assert.deepEqual(g.ids, ["role1", "role1"], "scoped: false");
});

// ---- the one walk rule: an empty page ends a walk, and so does a next that is the place just read; for the flat list, list_after and a per-parent list alike

function flat(answer: (action: string, input: Record<string, unknown>) => unknown) {
  const calls: { action: string; input: Record<string, unknown> }[] = [];
  const ctx = {
    trace: { traceId: "t1" },
    call: async (_cap: string, a: { action: string; input?: Record<string, unknown> }): Promise<unknown> => {
      calls.push({ action: a.action, input: a.input ?? {} });
      if (calls.length > 200) throw new Error("the walk did not end");
      return { output: answer(a.action, a.input ?? {}) };
    },
  };
  const s = remoteStore(ctx as never, { connector: "crm_x", connectionId: "con_1", remote: "things" }, undefined);
  return { s, calls };
}
const row = (id: string) => ({ id, properties: { name: id } });

test("flat list: a first page that is empty but has a next ends the walk (it was an endless one)", async () => {
  const { s, calls } = flat(() => ({ results: [], next: "x" }));
  const g = await s.page();
  assert.deepEqual(g.rows, []);
  assert.equal(g.next, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual((await s.query("things", {} as never)).rows, [], "and the whole listing ends too");
});

test("list_after: an answer whose next is the place just asked from ends the walk, rows kept", async () => {
  const { s, calls } = flat((action) =>
    action === "list_things" ? { results: [row("a")], next: "x" } : { results: [row("b")], next: "x" },
  );
  const first = await s.page();
  assert.equal(first.next, "x");
  const second = await s.page("x");
  assert.deepEqual(
    second.rows.map((r) => r.id),
    ["b"],
    "the page's rows are kept",
  );
  assert.equal(second.next, undefined, "the same place again is the end");
  assert.ok(
    s.notes.some((n) => n.includes("place it had been asked from")),
    "and it is said",
  );
  assert.equal(calls.length, 2);
});

test("list_after: an empty page with a next that keeps changing ends at the first empty page", async () => {
  let n = 0;
  const { s, calls } = flat((action) =>
    action === "list_things" ? { results: [row("a")], next: "1" } : { results: [], next: String(++n + 1) },
  );
  const first = await s.page();
  const second = await s.page(first.next);
  assert.deepEqual(second.rows, []);
  assert.equal(second.next, undefined);
  assert.equal(calls.length, 2);
});

test("per parent: a parent whose list is empty with the same next, or empty with a next that changes, is read once and passed over", async () => {
  let n = 0;
  const calls: string[] = [];
  const ctx = {
    trace: { traceId: "t1" },
    call: async (_cap: string, a: { action: string; input?: Record<string, unknown> }): Promise<unknown> => {
      calls.push(a.action + ":" + String(a.input?.["parent"] ?? "-") + ":" + String(a.input?.["after"] ?? "-"));
      if (calls.length > 100) throw new Error("the walk did not end");
      if (a.action === "list_matters")
        return {
          output: {
            results: [
              { id: "mA", properties: {} },
              { id: "mB", properties: {} },
              { id: "mC", properties: {} },
            ],
          },
        };
      const p = a.input?.["parent"];
      if (p === "mA") return { output: { results: [], next: "x" } };
      if (p === "mB") return { output: { results: [], next: String(++n) } };
      return { output: { results: [row("c1")] } };
    },
  };
  const s = remoteStore(ctx as never, { connector: "crm_intake", connectionId: "con_1", remote: "contacts" }, OBJECTS);
  const got = await drain(s);
  assert.deepEqual(got.ids, ["c1"]);
  assert.equal(calls.filter((c) => c.startsWith("list_contacts")).length, 3, "one read for each parent");
  assert.deepEqual(
    (await store(ctx).query("contacts", {} as never)).rows.map((r) => r.id),
    ["c1"],
  );
});

// ---- where, changed, unsafe ids

function kids(
  parentsData: Record<string, Record<string, unknown>>,
  children: Record<string, string[]>,
  feed?: { matter: string; at: string }[],
) {
  const calls: string[] = [];
  const ctx = {
    trace: { traceId: "t1" },
    call: async (_cap: string, a: { action: string; input?: Record<string, unknown> }): Promise<unknown> => {
      const p = String(a.input?.["parent"] ?? "-");
      calls.push(a.action + ":" + p);
      if (a.action === "list_matters")
        return { output: { results: Object.entries(parentsData).map(([id, properties]) => ({ id, properties })) } };
      if (a.action === "list_events")
        return {
          output: {
            results: (feed ?? []).map((f, i) => ({
              id: "e" + i,
              properties: { "/matter/id": f.matter, "/occured_at": f.at },
            })),
          },
        };
      return { output: { results: (children[p] ?? []).map(row) } };
    },
  };
  return { ctx, calls };
}
const objectsWith = (eachOf: Record<string, unknown>) => ({
  matters: { list: "list_matters" },
  events: { list: "list_events" },
  contacts: {
    list: "list_contacts",
    listAfter: "list_contacts_after",
    eachOf: { remote: "matters", scoped: false, ...eachOf },
  },
});
const storeWith = (ctx: unknown, eachOf: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  remoteStore(
    ctx as never,
    { connector: "crm_intake", connectionId: "con_1", remote: "contacts" },
    objectsWith(eachOf),
    extra as never,
  );

test("where: only the parents that meet it have their children read", async () => {
  const w = kids(
    { mA: { "/sub": true }, mB: { "/sub": false }, mC: { "/sub": true }, mD: {} },
    { mA: ["a"], mB: ["b"], mC: ["c"], mD: ["d"] },
  );
  const got = await drain(storeWith(w.ctx, { where: { path: "/sub", e: ["true"] } }) as never);
  assert.deepEqual(got.ids, ["a", "c"]);
  assert.deepEqual(
    w.calls.filter((c) => c.startsWith("list_contacts")),
    ["list_contacts:mA", "list_contacts:mC"],
  );
  const not = kids({ mA: { "/sub": true }, mB: { "/sub": false } }, { mA: ["a"], mB: ["b"] });
  assert.deepEqual((await drain(storeWith(not.ctx, { where: { path: "/sub", e: ["true"], n: true } }) as never)).ids, [
    "b",
  ]);
  const re = kids({ mA: { "/k": "planning" }, mB: { "/k": "rep-living" } }, { mA: ["a"], mB: ["b"] });
  assert.deepEqual((await drain(storeWith(re.ctx, { where: { path: "/k", m: ["rep"] } }) as never)).ids, ["b"]);
});

test("changed (the parent's own field): a delta pass reads only the parents whose version moved; a full pass reads all and says which were read", async () => {
  const w = kids(
    { mA: { "/rev": "1" }, mB: { "/rev": "2" }, mC: { "/rev": "3" } },
    { mA: ["a"], mB: ["b"], mC: ["c"] },
  );
  const stored: Record<string, string> = { mA: "1", mB: "OLD" };
  const s = storeWith(w.ctx, { changed: { path: "/rev" } }, { versionOf: (p: string) => stored[p] }) as ReturnType<
    typeof store
  >;
  assert.equal(s.supportsSince, true, "a per-parent list is read as a delta list");
  const delta = await s.page(undefined, 123);
  const ids: string[] = [];
  let g = delta;
  for (let i = 0; i < 9; i++) {
    ids.push(...g.rows.map((r) => r.id));
    if (!g.next) break;
    g = await s.page(g.next, 123);
  }
  assert.deepEqual(ids, ["b", "c"], "mA's version did not move; mB's did; mC was never read");
  assert.deepEqual(
    w.calls.filter((c) => c.startsWith("list_contacts")),
    ["list_contacts:mB", "list_contacts:mC"],
  );
  assert.deepEqual(
    [...s.pendingVersions],
    [
      ["mB", "2"],
      ["mC", "3"],
    ],
    "versions of what was read, kept by the engine once the rows are in",
  );
  const w2 = kids({ mA: { "/rev": "1" }, mB: { "/rev": "2" } }, { mA: ["a"], mB: ["b"] });
  const full = storeWith(w2.ctx, { changed: { path: "/rev" } }, { versionOf: () => "1" }) as ReturnType<typeof store>;
  const all = await drain(full);
  assert.deepEqual(all.ids, ["a", "b"], "no since: every parent");
});

test("changed (a feed object): a parent's version is the newest stamp the feed holds for it", async () => {
  const feed = [
    { matter: "mA", at: "2026-11-01T00:00:00Z" },
    { matter: "mA", at: "2026-11-05T00:00:00Z" },
    { matter: "mB", at: "2026-10-01T00:00:00Z" },
  ];
  const w = kids({ mA: {}, mB: {}, mC: {} }, { mA: ["a"], mB: ["b"], mC: ["c"] }, feed);
  const stored: Record<string, string> = { mA: "2026-11-01T00:00:00Z", mB: "2026-10-01T00:00:00Z", mC: "" };
  const s = storeWith(
    w.ctx,
    { changed: { object: "events", parentAt: "/matter/id", at: "/occured_at" } },
    { versionOf: (p: string) => stored[p] },
  ) as ReturnType<typeof store>;
  const ids: string[] = [];
  let g = await s.page(undefined, 1);
  for (let i = 0; i < 9; i++) {
    ids.push(...g.rows.map((r) => r.id));
    if (!g.next) break;
    g = await s.page(g.next, 1);
  }
  assert.deepEqual(
    ids,
    ["a"],
    "only mA has an event newer than its stored version; mB is unchanged; mC has none and was read before",
  );
  assert.equal(w.calls.filter((c) => c === "list_events:-").length, 1, "the feed is read once");
});

test("a parent id that cannot go in an address is skipped and said once; the pass goes on", async () => {
  const w = kids({ mA: {}, "m/B": {}, "..": {}, "m?C": {}, mD: {} }, { mA: ["a"], mD: ["d"] });
  const s = storeWith(w.ctx, {}) as ReturnType<typeof store>;
  const got = await drain(s);
  assert.deepEqual(got.ids, ["a", "d"]);
  assert.equal(s.notes.filter((n) => n.includes("3 parents skipped")).length, 1);
});

test("the parent list is read once for several passes when a cache keeps it", async () => {
  const w = kids({ mA: {}, mB: {} }, { mA: ["a"], mB: ["b"] });
  let kept: unknown;
  const opts = { parentCache: { get: () => kept as never, set: (i: unknown) => (kept = i) } };
  await drain(storeWith(w.ctx, {}, opts) as never);
  await drain(storeWith(w.ctx, {}, opts) as never);
  assert.equal(w.calls.filter((c) => c === "list_matters:-").length, 1);
});
