// A person is added to a private agent chat through the real invoke pipeline (rule 27): a real kernel, real authorization and the log, with the chat handlers behind them. The chat becomes a group chat;
// with history hidden (the default) the newcomer reads only from then on, and with Include earlier messages (fromStart) they read it all. Callers go in as people of the seeded Space.
import test from "node:test";
import assert from "node:assert/strict";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { createTestSpace } from "../../../testkit/src/index.ts";
import { handlers } from "../impl.ts";
import { openRaw } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<unknown> | unknown;
const h = handlers as unknown as Record<string, Fn>;
const CAPS = ["chat.start", "chat.post", "chat.messages.list", "chat.message.get", "chat.history.page", "chat.history.search", "threads.members.add", "threads.get"];

async function space() {
  const raw = openRaw();
  const withDb = (f: Fn): Fn => (ctx, input) => f({ ...ctx, db: scopedDb("chat", raw, ctx.trace.traceId) }, input);
  const s = await createTestSpace({ seed: "small", handlers: Object.fromEntries(CAPS.map((c) => [c, withDb(h[c]!)])) });
  return s;
}
const bodies = async (api: { call(cap: string, input: unknown): Promise<unknown> }, threadId: string): Promise<string[]> =>
  ((await api.call("chat.messages.list", { threadId })) as { messages: Array<{ body: string }> }).messages.map((m) => m.body);

test("a person added to a private agent chat reads only from then on; with Include earlier messages they read from the start", async () => {
  const s = await space();
  try {
    const ana = s.api("usr_ana");
    const bo = s.api("usr_bo");
    const started = (await ana.call("chat.start", { kind: "chat", agentIds: ["agt_intake"], idempotencyKey: "gc-live-1" })) as { thread: { threadId: string } };
    const id = started.thread.threadId;
    s.access.putResource({ id, type: "thread", parent_id: s.space, label: 0, owner_id: "usr_ana", holds: 0 });
    await ana.call("chat.post", { threadId: id, body: "The old retainer figure is 40000", idempotencyKey: "gc-live-2" });
    s.clock.advance(1_000);
    const grown = (await ana.call("threads.members.add", { threadId: id, personId: "usr_bo" })) as { thread: { members: Array<{ id: string }> } };
    assert.ok(grown.thread.members.some((m) => m.id === "usr_bo"), "the chat gained a person");
    s.clock.advance(1_000);
    await ana.call("chat.post", { threadId: id, body: "Welcome Bo", idempotencyKey: "gc-live-3" });
    const seen = await bodies(bo, id);
    assert.ok(seen.includes("Welcome Bo"));
    assert.ok(!seen.some((b) => b.includes("40000")), "Bo reads only from the moment they were added");
    await ana.call("threads.members.add", { threadId: id, personId: "usr_bo", fromStart: true });
    assert.ok((await bodies(bo, id)).some((b) => b.includes("40000")), "with Include earlier messages Bo reads it all");
    assert.equal(await s.events.verify(), true);
  } finally { await s.close(); }
});
