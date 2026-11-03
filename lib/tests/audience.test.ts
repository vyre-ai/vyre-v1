// Who reads a chat (lib/audience.ts): the one audience rule memory and the answer check share. A private chat is its people; an invite-only channel its members; a public channel and a chat that
// cannot be read are Space-wide. An Ask whose answer posts into a shared place (the Ask behind a record comment) is as wide as the Space; an Ask pane opened on a record, a file or an automation
// from the screen is private to the person who opened it.
import test from "node:test";
import assert from "node:assert/strict";
import { chatAudience, othersRead, within } from "../audience.ts";

const person = (id: string) => ({ kind: "person", id });
const agent = { kind: "agent", id: "agt_a" };
function world(threads: Record<string, Record<string, unknown>>, channels: Record<string, Record<string, unknown>> = {}) {
  return async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as { threadId?: string; channelId?: string };
    if (cap === "threads.get") { const t = threads[i.threadId ?? ""]; if (!t) throw new Error("not found"); return { thread: t }; }
    if (cap === "channels.get") { const c = channels[i.channelId ?? ""]; if (!c) throw new Error("not found"); return { channel: c }; }
    throw new Error(`unexpected ${cap}`);
  };
}

test("a private chat is its people; a thread under it adds its own", async () => {
  const call = world({ thr_c: { kind: "chat", starter: "usr_dana", members: [person("usr_dana"), agent] }, thr_t: { kind: "thread", parentThreadId: "thr_c", members: [person("usr_maya")] } });
  assert.deepEqual(await chatAudience(call, "thr_c"), { space: false, people: ["usr_dana"] });
  const t = await chatAudience(call, "thr_t");
  assert.equal(t.space, false);
  assert.deepEqual([...t.people].sort(), ["usr_dana", "usr_maya"]);
  assert.equal(othersRead(await chatAudience(call, "thr_c"), "usr_dana"), false);
});

test("an invite-only channel is its members; a public one is the Space's; a thread under either is the channel's", async () => {
  const call = world(
    { thr_i: { kind: "channel", channelId: "chn_i", members: [] }, thr_p: { kind: "channel", channelId: "chn_p", members: [] }, thr_it: { kind: "thread", parentThreadId: "thr_i", members: [] } },
    { chn_i: { visibility: "invite", members: [person("usr_dana"), person("usr_maya")] }, chn_p: { visibility: "public", members: [person("usr_dana")] } },
  );
  assert.deepEqual(await chatAudience(call, "thr_i"), { space: false, people: ["usr_dana", "usr_maya"] });
  assert.equal((await chatAudience(call, "thr_p")).space, true);
  assert.deepEqual(await chatAudience(call, "thr_it"), { space: false, people: ["usr_dana", "usr_maya"] });
});

test("a chat that cannot be read is Space-wide: nothing private goes in unless it is known to be safe", async () => {
  assert.equal((await chatAudience(world({}), "thr_gone")).space, true);
});

test("the Ask behind a record comment posts its answer on the record, so it is Space-wide though one person is in it", async () => {
  const call = world({ thr_rc: { kind: "ask", starter: "usr_dana", recordId: "rec_1", scopeType: "record", scopeId: "rec_1", members: [person("usr_dana"), agent] } });
  const a = await chatAudience(call, "thr_rc");
  assert.equal(a.space, true);
  assert.equal(othersRead(a, "usr_dana"), true, "Dana's own memory stays out of it");
});

test("an Ask pane opened on a record, a file or an automation is private to the person who opened it", async () => {
  for (const scopeType of ["record", "file", "automation"]) {
    const call = world({ thr_ask: { kind: "ask", starter: "usr_dana", scopeType, scopeId: `${scopeType}_1`, members: [person("usr_dana"), agent] } });
    const a = await chatAudience(call, "thr_ask");
    assert.deepEqual(a, { space: false, people: ["usr_dana"] }, scopeType);
    assert.equal(othersRead(a, "usr_dana"), false, `${scopeType}: her own memory may come in`);
  }
});

test("within: a chat's people must all be among those the words were for", () => {
  const dm = { space: false, people: ["usr_dana", "usr_maya"] };
  assert.equal(within({ space: false, people: ["usr_dana"] }, dm), true);
  assert.equal(within({ space: false, people: ["usr_dana", "usr_leo"] }, dm), false);
  assert.equal(within({ space: true, people: [] }, dm), false, "a Space-wide chat is never inside a group");
  assert.equal(within({ space: true, people: [] }, { space: true, people: [] }), true);
});
