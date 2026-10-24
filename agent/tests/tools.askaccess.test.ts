// Ask access property (ARCH 4.13): what an Ask pane offers follows the viewer's level on the scope. A view-only person's pane never invokes above view.
import test from "node:test";
import assert from "node:assert/strict";
import { allowedAtLevel, LEVEL_RANK } from "../src/tools/index.ts";
import type { Level, ToolCtx } from "../src/tools/index.ts";
import { ctx, makeSession, thread } from "../src/tools/harness.ts";

const scope = { type: "record", id: "rec_1" };
const levels = (l: Level): Record<string, Level> => ({ "per_dana:record:rec_1": l });
const askCtx = (): ToolCtx => ctx({ thread: thread({ kind: "ask", scope }) });
const nameOf = (catalog: { all: readonly { name: string; cap: string }[] }, cap: string): string => {
  const t = catalog.all.find((x) => x.cap === cap);
  assert.ok(t, `tool for ${cap}`);
  return t.name;
};

test("view-only: only read tools at view, plus access.propose_change", () => {
  const { session, loaded } = makeSession({ levels: levels("view") });
  const set = session.toolsFor(askCtx());
  assert.equal(set.level, "view");
  const offered = [...set.listed, ...set.searchable];
  assert.ok(offered.length > 50, "a view-only pane still has plenty to read with");
  for (const t of offered) {
    assert.equal(t.level, "view", `${t.name} is above view`);
    assert.ok(t.effects === "read" || t.cap === "access.propose_change", `${t.name} writes at view`);
  }
  const names = new Set(offered.map((t) => t.name));
  assert.ok(names.has(nameOf(loaded.catalog, "access.propose_change")), "propose a change is offered");
  assert.ok(names.has("records_get"));
  assert.ok(!names.has("records_update"), "no edit tool");
  assert.ok(!names.has("ask_question"), "the question card is a use-level tool");
});

test("property: a view-only Ask pane never invokes above view, whatever the model asks for", async () => {
  const { session, calls, loaded } = makeSession({ levels: levels("view"), engineer: true });
  const c = askCtx();
  let offered = 0, refused = 0;
  for (const t of loaded.catalog.all) {
    const ok = allowedAtLevel("view", t);
    if (ok && !loaded.defaults.has(t.name)) { session.search(c, t.name); assert.ok(session.loaded(c.thread.threadId).has(t.name), `${t.name} found by search`); }
    const before = calls.length;
    const out = await session.call(c, t.name, {});
    if (ok) {
      offered++;
      assert.notEqual(out.kind === "error" && out.error.code === "permission.role_lacks_permission", true, `${t.name} was refused at view`);
    } else {
      refused++;
      assert.equal(out.kind, "error", t.name);
      if (out.kind === "error") assert.equal(out.error.code, "permission.role_lacks_permission", t.name);
      assert.equal(calls.length, before, `${t.name} reached invoke`);
    }
  }
  assert.ok(offered > 50 && refused > 500, `${offered} offered, ${refused} refused`);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    const cap = loaded.caps.get(call.cap);
    assert.ok(cap, call.cap);
    assert.equal(cap.level, "view", `${call.cap} is above view`);
    assert.ok(cap.effects === "read" || call.cap === "access.propose_change", `${call.cap} writes at view`);
    assert.equal(call.principal, "agt_intake");
    assert.equal(call.actingFor, "per_dana", "the call is the intersection with the asker");
  }
});

test("use adds use-level tools but nothing at edit or manage", async () => {
  const { session, calls, loaded } = makeSession({ levels: levels("use"), engineer: true });
  const c = askCtx();
  const set = session.toolsFor(c);
  assert.equal(set.level, "use");
  const offered = [...set.listed, ...set.searchable];
  assert.ok(offered.some((t) => t.level === "use"), "use-level tools appear");
  assert.ok(offered.every((t) => LEVEL_RANK[t.level] <= LEVEL_RANK.use));
  assert.ok(set.listed.some((t) => t.name === "ask_question"));
  for (const t of loaded.catalog.all) if (LEVEL_RANK[t.level] > LEVEL_RANK.use) {
    const out = await session.call(c, t.name, {});
    assert.equal(out.kind, "error", t.name);
  }
  assert.equal(calls.length, 0, "nothing above use reached invoke");
});

test("edit and manage get the full set the agent and asker share", () => {
  const { session, loaded } = makeSession({ levels: levels("edit") });
  const edit = session.toolsFor(askCtx());
  const manage = makeSession({ levels: levels("manage") }).session.toolsFor(askCtx());
  const nonEngineer = loaded.catalog.all.filter((t) => t.toolset !== "engineer");
  assert.equal(edit.listed.length + edit.searchable.length, nonEngineer.filter((t) => t.level !== "manage").length);
  assert.equal(manage.listed.length + manage.searchable.length, nonEngineer.length);
  assert.ok(edit.listed.some((t) => t.name === "records_update"));
});

test("a refusal above the level offers Ask for access with the level the tool needs", async () => {
  const { session } = makeSession({ levels: levels("view") });
  const out = await session.call(askCtx(), "records_update", {});
  assert.equal(out.kind, "error");
  if (out.kind !== "error") return;
  assert.equal(out.error.code, "permission.role_lacks_permission");
  assert.equal(out.error.details?.["reason"], "ask_level");
  const next = out.error.next.find((n) => n.kind === "ask_access");
  assert.ok(next?.action);
  assert.equal(next.action.cap, "access.request");
  assert.deepEqual(next.action.input, { resource: scope, level: "edit" });
});

test("no access to the scope at all: no tools, and a call is no_grant", async () => {
  const { session } = makeSession({ levels: {} });
  const c = askCtx();
  const set = session.toolsFor(c);
  assert.equal(set.level, null);
  assert.deepEqual([set.listed.length, set.searchable.length], [0, 0]);
  const out = await session.call(c, "records_get", {});
  assert.equal(out.kind === "error" && out.error.code, "permission.no_grant");
});

test("an Ask pane with no scope gets the narrowest set, and other thread kinds are not level-limited", () => {
  const { session } = makeSession({ levels: levels("manage") });
  const bare = session.toolsFor(ctx({ thread: thread({ kind: "ask" }) }));
  assert.equal(bare.level, "view");
  const chat = session.toolsFor(ctx());
  assert.equal(chat.level, "manage");
  assert.ok(chat.listed.some((t) => t.name === "records_update"));
});
