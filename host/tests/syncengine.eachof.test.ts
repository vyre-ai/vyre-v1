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
  contacts: { list: "list_contacts", listAfter: "list_contacts_after", eachOf: { remote: "matters" } },
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
  assert.deepEqual(namesFor(OBJECTS, "contacts").eachOf, { remote: "matters" });
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
