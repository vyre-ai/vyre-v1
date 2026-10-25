// Ask panes through the invoke pipeline (rule 27): a real kernel, real authorization over roles and grants, event validation and the log, with the chat handlers behind them. Callers go in as
// people with the roles of the seeded Space; the refusal cases are the pipeline's and the handler's own.
import test from "node:test";
import assert from "node:assert/strict";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { createTestSpace } from "../../../testkit/src/index.ts";
import { askHandlers } from "../handlers/index.ts";
import { handlers } from "../impl.ts";
import { openRaw } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<unknown> | unknown;
const h = handlers as unknown as Record<string, Fn>;
const A = askHandlers as unknown as Record<string, Fn>;

async function spaceWithChat() {
  const raw = openRaw();
  const withDb = (f: Fn): Fn => (ctx, input) => f({ ...ctx, db: scopedDb("chat", raw, ctx.trace.traceId), authorize: (_a: unknown, r: { id: string | null }) => ({ effect: r.id === "rec_secret" ? "deny" : "allow", reason: "test", decisionId: "dec_1" }) }, input);
  const space = await createTestSpace({
    seed: "small",
    handlers: {
      "chat.start": withDb(h["chat.start"]!),
      "chat.post": withDb(h["chat.post"]!),
      "chat.ask_suggest": withDb(A["chat.ask_suggest"]!),
      "chat.asks_of": withDb(A["chat.asks_of"]!),
      "chat.open_as_chat": withDb(A["chat.open_as_chat"]!),
      // What the handlers read through the capability API: the person's last Ask agent. Who may see which object comes from the context's authorize, stubbed above.
      "settings.get": () => ({ row: { key: "chat.ask_agent", scope: "person", page: "models", title: "Agent I last used in Ask panes", value: "agt_last", source: "person" } }),
    },
  });
  return space;
}

const errorOf = async (f: () => Promise<unknown>): Promise<{ code?: string; next?: Array<{ kind: string; action?: { cap: string } }> }> => {
  try { await f(); } catch (e) { return (e as { error: { code?: string; next?: Array<{ kind: string }> } }).error; }
  return {};
};

test("a member starts an Ask pane, finds it in the object's history, and nobody else does; opening it as a chat lists it", async () => {
  const space = await spaceWithChat();
  try {
    const ana = space.api("usr_ana");
    const bo = space.api("usr_bo");
    const started = (await ana.call("chat.start", { kind: "ask", agentIds: ["agt_intake"], scopeType: "record", scopeId: "rec_ok", idempotencyKey: "ask1" })) as { thread: { threadId: string; listed: boolean } };
    assert.equal(started.thread.listed, false);
    // The host registers a created thread as a resource owned by its creator in the same commit (invoke.ts, P-H_16); the test space has no resource registry, so the snapshot gets the row here.
    space.access.putResource({ id: started.thread.threadId, type: "thread", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 });

    const mine = (await ana.call("chat.asks_of", { resourceType: "record", resourceId: "rec_ok" })) as { threads: Array<{ threadId: string }>; total: number };
    assert.deepEqual(mine.threads.map((t) => t.threadId), [started.thread.threadId]);
    const theirs = (await bo.call("chat.asks_of", { resourceType: "record", resourceId: "rec_ok" })) as { threads: unknown[]; total: number };
    assert.deepEqual([theirs.threads.length, theirs.total], [0, 0], "an Ask pane is private to the person who opened it");

    assert.match((await errorOf(() => bo.call("chat.open_as_chat", { threadId: started.thread.threadId }))).code ?? "", /^(validation\.not_found|permission\.(not_found|no_grant))$/, "someone else's pane does not exist for them");
    const opened = (await ana.call("chat.open_as_chat", { threadId: started.thread.threadId })) as { thread: { listed: boolean } };
    assert.equal(opened.thread.listed, true);
    assert.ok(space.published.some((e) => e.type === "thread.updated"));
    assert.equal(await space.events.verify(), true);
  } finally { await space.close(); }
});

test("the suggested agent comes back through the pipeline; a guest, who holds no grant, is refused before the handler runs", async () => {
  const space = await spaceWithChat();
  try {
    assert.deepEqual(await space.api("usr_ana").call("chat.ask_suggest", { scopeType: "file", scopeId: "fil_1" }), { agentId: "agt_last", reason: "last_used" });
    const guest = await errorOf(() => space.api("usr_guest").call("chat.ask_suggest", { scopeType: "file", scopeId: "fil_1" }));
    assert.match(guest.code ?? "", /^permission\./);
    assert.equal((await errorOf(() => space.api("usr_guest").call("chat.asks_of", { resourceType: "record", resourceId: "rec_ok" }))).code?.startsWith("permission."), true);
    assert.equal((await errorOf(() => space.api("usr_guest").call("chat.start", { kind: "ask", agentIds: ["agt_intake"], scopeType: "record", scopeId: "rec_ok", idempotencyKey: "g1" }))).code?.startsWith("permission."), true);
  } finally { await space.close(); }
});

test("an object the member cannot see returns the Ask for access link through the pipeline, with the request they would send", async () => {
  const space = await spaceWithChat();
  try {
    const err = await errorOf(() => space.api("usr_ana").call("chat.asks_of", { resourceType: "record", resourceId: "rec_secret" }));
    assert.equal(err.code, "permission.no_grant");
    const step = err.next?.find((n) => n.kind === "ask_access");
    assert.ok(step, "the error carries the Ask for access step");
    assert.equal(step?.action?.cap, "access.request");
    assert.equal((await errorOf(() => space.api("usr_ana").call("chat.ask_suggest", { scopeType: "record", scopeId: "rec_secret" }))).code, "permission.no_grant");
  } finally { await space.close(); }
});
