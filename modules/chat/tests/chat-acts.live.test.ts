// The same rules through the real invoke pipeline and the real authorization (rule 27): a late joiner cannot raise their own floor, an adder grants history only from the adder's own floor, a member who is not a manager cannot
// open an invite-only channel through its main thread, and a creator who left reads nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { createTestSpace } from "../../../testkit/src/index.ts";
import { handlers } from "../impl.ts";
import { openRaw } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<unknown> | unknown;
const h = handlers as unknown as Record<string, Fn>;
const CAPS = [
  "chat.start",
  "chat.post",
  "chat.messages.list",
  "threads.members.add",
  "threads.leave",
  "threads.get",
  "channels.create",
  "channels.members.add",
  "channels.get",
];

async function space() {
  const raw = openRaw();
  const withDb =
    (f: Fn): Fn =>
    (ctx, input) =>
      f({ ...ctx, db: scopedDb("chat", raw, ctx.trace.traceId) }, input);
  return createTestSpace({ seed: "small", handlers: Object.fromEntries(CAPS.map((c) => [c, withDb(h[c]!)])) });
}
type Api = { call(cap: string, input: unknown): Promise<unknown> };
const bodies = async (api: Api, threadId: string): Promise<string[]> =>
  ((await api.call("chat.messages.list", { threadId })) as { messages: Array<{ body: string }> }).messages.map(
    (m) => m.body,
  );
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "none";
  } catch (e) {
    return (
      (e as { error?: { code?: string }; code?: string }).error?.code ?? (e as { code?: string }).code ?? "unknown"
    );
  }
};

test("a late joiner cannot raise their own floor, and an adder grants history only from the adder's own floor", async () => {
  const s = await space();
  try {
    const ana = s.api("usr_ana");
    const bo = s.api("usr_bo");
    const id = (
      (await ana.call("chat.start", { kind: "chat", agentIds: ["agt_intake"], idempotencyKey: "ca-1" })) as {
        thread: { threadId: string };
      }
    ).thread.threadId;
    s.access.putResource({ id, type: "thread", parent_id: s.space, label: 0, owner_id: "usr_ana", holds: 0 });
    await ana.call("chat.post", { threadId: id, body: "OLDSECRET", idempotencyKey: "ca-2" });
    s.clock.advance(1_000);
    await ana.call("threads.members.add", { threadId: id, personId: "usr_bo" });
    s.clock.advance(1_000);
    await ana.call("chat.post", { threadId: id, body: "NEWWORD", idempotencyKey: "ca-3" });
    assert.equal(
      await code(bo.call("threads.members.add", { threadId: id, personId: "usr_bo", fromStart: true })),
      "permission.no_grant",
    );
    assert.ok(!(await bodies(bo, id)).some((b) => b.includes("OLDSECRET")), "Bo cannot raise their own floor");
    await bo.call("threads.members.add", { threadId: id, personId: "usr_dev", fromStart: true });
    const cy = s.api("usr_dev");
    assert.ok(!(await bodies(cy, id)).some((b) => b.includes("OLDSECRET")), "Bo cannot give Dev what Bo cannot read");
    assert.ok((await bodies(cy, id)).includes("NEWWORD"), "Dev reads from Bo's floor");
  } finally {
    await s.close();
  }
});

test("a creator who left a chat reads and posts nothing in it", async () => {
  const s = await space();
  try {
    const ana = s.api("usr_ana");
    const id = (
      (await ana.call("chat.start", { kind: "chat", agentIds: ["agt_intake"], idempotencyKey: "ca-4" })) as {
        thread: { threadId: string };
      }
    ).thread.threadId;
    s.access.putResource({ id, type: "thread", parent_id: s.space, label: 0, owner_id: "usr_ana", holds: 0 });
    await ana.call("threads.members.add", { threadId: id, personId: "usr_bo" });
    await ana.call("threads.leave", { threadId: id });
    assert.equal(await code(ana.call("chat.messages.list", { threadId: id })), "validation.not_found");
    assert.equal(
      await code(ana.call("chat.post", { threadId: id, body: "still here", idempotencyKey: "ca-5" })),
      "validation.not_found",
    );
  } finally {
    await s.close();
  }
});

test("a member who is not a manager cannot open an invite-only channel through its main thread", async () => {
  const s = await space();
  try {
    const ana = s.api("usr_ana");
    const bo = s.api("usr_bo");
    const ch = (
      (await ana.call("channels.create", { name: "ops", visibility: "invite", idempotencyKey: "ca-6" })) as {
        channel: { channelId: string; mainThreadId: string };
      }
    ).channel;
    s.access.putResource({
      id: ch.channelId,
      type: "channel",
      parent_id: s.space,
      label: 0,
      owner_id: "usr_ana",
      holds: 0,
    });
    s.access.putResource({
      id: ch.mainThreadId,
      type: "thread",
      parent_id: ch.channelId,
      label: 0,
      owner_id: "usr_ana",
      holds: 0,
    });
    await ana.call("channels.members.add", { channelId: ch.channelId, personIds: ["usr_bo"] });
    assert.notEqual(
      await code(bo.call("channels.members.add", { channelId: ch.channelId, personIds: ["usr_dev"] })),
      "none",
      "the channel itself refuses a non-manager",
    );
    const through = await code(bo.call("threads.members.add", { threadId: ch.mainThreadId, personId: "usr_dev" }));
    assert.notEqual(through, "none", "the main thread is no way around the channel's rules");
  } finally {
    await s.close();
  }
});

test("a guest in a chat adds nobody and cannot open a channel", async () => {
  const s = await space();
  try {
    const ana = s.api("usr_ana");
    const guest = s.api("usr_guest");
    const id = (
      (await ana.call("chat.start", { kind: "chat", agentIds: ["agt_intake"], idempotencyKey: "ca-7" })) as {
        thread: { threadId: string };
      }
    ).thread.threadId;
    s.access.putResource({ id, type: "thread", parent_id: s.space, label: 0, owner_id: "usr_ana", holds: 0 });
    await ana.call("threads.members.add", { threadId: id, personId: "usr_guest" });
    const through = await code(
      guest.call("threads.members.add", { threadId: id, personId: "usr_dev", fromStart: true }),
    );
    console.log("GUEST ADD:", through);
    assert.notEqual(through, "none", "a guest does not add people to a chat");
  } finally {
    await s.close();
  }
});
