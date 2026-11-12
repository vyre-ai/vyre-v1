// Leaving or being taken out of a chat or a channel takes away, by the time the call returns, exactly what that membership gave: a person's view of the agents the chat made for itself, and an
// agent's grants from a channel it was taken out of. A grant held for another reason (a direct share, another chat) stays. The race between a person being added (its grants are still being
// written) and the same person being removed is held deterministically.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, LEO, harness as baseHarness } from "../fixtures/harness.ts";
import { addMember, insertThread } from "../projections.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `or${++n}`;
const OUTSIDE = "agt_cc";
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

interface G { resource: { type: string; id: string }; subject: { kind: string; id: string }; level: string; source?: string }
function world() {
  const grants: G[] = [];
  let made = 0;
  let hold: { match: (i: G) => boolean; gate: Promise<void>; reached: () => void } | null = null;
  const hn = baseHarness({
    calls: {
      "agents.get": (i) => ({ agent: { agentId: i["agentId"], name: String(i["agentId"]), runtime: i["agentId"] === OUTSIDE ? "outside" : "vyre" } }),
      "access.principals.get": () => ({ principal: { name: "Someone" } }),
      "agents.outside.usable": () => ({ usable: true }),
      "agents.outside.enqueue": () => ({ queued: true }),
      "agents.create": () => ({ agent: { agentId: `agt_made${++made}` } }),
      "agents.delete": () => ({ deleted: true }),
      "engine.set_mode": (i) => ({ mode: i["mode"], leadAgentId: null }),
      "engine.stop_all": () => ({ stopped: 0 }),
      "files.resolve": () => { throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); },
      "access.share": async (i) => {
        const g = { resource: i["resource"], subject: i["subject"], level: String(i["level"]), ...(i["source"] ? { source: String(i["source"]) } : {}) } as G;
        if (hold && hold.match(g)) { const x = hold; hold = null; x.reached(); await x.gate; }
        if (!grants.some((x) => x.resource.id === g.resource.id && x.subject.id === g.subject.id && x.source === g.source)) grants.push(g);
        return { grant: { id: `gnt_${grants.length}` } };
      },
      "access.unshare": (i) => {
        const r = i["resource"] as { type: string; id: string } | undefined, s = i["subject"] as { kind: string; id: string } | undefined, src = i["source"] as string | undefined;
        const before = grants.length;
        for (let k = grants.length - 1; k >= 0; k--) {
          const g = grants[k]!;
          if (r && (g.resource.id !== r.id || g.resource.type !== r.type)) continue;
          if (s && (g.subject.id !== s.id || g.subject.kind !== s.kind)) continue;
          if (src !== undefined && g.source !== src) continue;
          grants.splice(k, 1);
        }
        return { revoked: before - grants.length };
      },
    },
  });
  return {
    hn, grants,
    /** hold the next access.share that matches until released */
    holdShare(match: (g: G) => boolean): { held: Promise<void>; release: () => void } {
      let release!: () => void, reached!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const held = new Promise<void>((r) => { reached = r; });
      hold = { match, gate, reached };
      return { held, release };
    },
  };
}
const on = (grants: G[], who: string, agentId: string): G[] => grants.filter((g) => g.subject.id === who && g.resource.type === "agent" && g.resource.id === agentId);

test("a person removed from a chat while their grants on its own agents are still being written holds nothing on them", async () => {
  const { hn, grants, holdShare } = world();
  const threadId = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const agentId = (await h["threads.agent.create"]!(hn.ctx, { threadId, name: "Checker", idempotencyKey: key() })).agentId as string;
  const hold = holdShare((g) => g.subject.id === LEO && g.resource.id === agentId);
  const adding = h["threads.members.add"]!(hn.ctx, { threadId, personId: LEO });
  await hold.held;
  const removing = h["threads.members.remove"]!(hn.ctx, { threadId, personId: LEO });
  await tick();   // every fake answers in a microtask: the remove has finished, or it waits for the add
  hold.release();
  await Promise.all([adding, removing]);
  assert.deepEqual(on(grants, LEO, agentId), [], "Leo, removed, holds nothing on the chat's agent");
  assert.equal(on(grants, DANA, agentId).length, 1, "the starter keeps hers");
});

for (const how of ["channels.members.remove", "channels.leave"] as const) {
  test(`${how}: the person loses their view of the channel's own agents, and keeps a grant they hold for another reason`, async () => {
    const { hn, grants } = world();
    const ch = (await h["channels.create"]!(hn.ctx, { name: "build", visibility: "invite", memberIds: [LEO], idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
    const a = (await h["threads.agent.create"]!(hn.ctx, { threadId: ch.mainThreadId, name: "Builder", idempotencyKey: key() })).agentId as string;
    assert.equal(on(grants, LEO, a).length, 1, "a member of the channel sees its agent");
    grants.push({ resource: { type: "agent", id: a }, subject: { kind: "person", id: LEO }, level: "use", source: "direct" });   // shared with Leo by hand as well
    if (how === "channels.members.remove") await h[how]!(hn.ctx, { channelId: ch.channelId, personId: LEO });
    else await h[how]!(hn.as({ kind: "person", id: LEO }), { channelId: ch.channelId });
    assert.deepEqual(on(grants, LEO, a).map((g) => g.source), ["direct"], "only what the channel gave is gone");
  });
}

test("channels.agents.remove: the agent loses what the channel gave it", async () => {
  const { hn, grants } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "invite", idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  await h["threads.outside_agent.add"]!(hn.ctx, { threadId: ch.mainThreadId, agentId: OUTSIDE });
  const given = grants.filter((g) => g.subject.id === OUTSIDE);
  assert.ok(given.length > 0 && given.every((g) => g.source === `chat:${ch.mainThreadId}`), "the channel gave it grants of its own");
  grants.push({ resource: { type: "folder", id: "fld_other" }, subject: { kind: "agent", id: OUTSIDE }, level: "view", source: "direct" });
  await h["channels.agents.remove"]!(hn.ctx, { channelId: ch.channelId, agentId: OUTSIDE });
  assert.deepEqual(grants.filter((g) => g.subject.id === OUTSIDE).map((g) => g.source), ["direct"], "what the channel gave is gone; the direct share stays");
});

test("taken out of an invite-only channel: a thread under it they replied in no longer gives them its agent, and they are not listed in it", async () => {
  const { hn, grants } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "legal", visibility: "invite", memberIds: [LEO], idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  // Leo replied in thread T under the channel: a reply makes him a member of T
  const t = insertThread(hn.ctx, { kind: "chat", title: "T", starter: DANA, listed: true, channelId: ch.channelId, parentThreadId: ch.mainThreadId });
  addMember(hn.ctx, t.id, DANA, "owner");
  addMember(hn.ctx, t.id, LEO);
  const a = (await h["threads.agent.create"]!(hn.ctx, { threadId: t.id, name: "T helper", idempotencyKey: key() })).agentId as string;
  assert.equal(on(grants, LEO, a).length, 1, "Leo, in the channel, sees T's agent");
  await h["channels.members.remove"]!(hn.ctx, { channelId: ch.channelId, personId: LEO });
  assert.deepEqual(on(grants, LEO, a), [], "he cannot read T any more, so he holds nothing on its agent");
  assert.equal(hn.rows("SELECT * FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, LEO).length, 0, "and he is not listed in T");
});

test("leaving an open channel: a thread under it they were added to directly, and can still read, keeps what it gave them", async () => {
  const { hn, grants } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "open", visibility: "public", memberIds: [LEO], idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  const t = insertThread(hn.ctx, { kind: "chat", title: "Side", starter: DANA, listed: true, channelId: ch.channelId, parentThreadId: ch.mainThreadId });
  addMember(hn.ctx, t.id, DANA, "owner");
  const a = (await h["threads.agent.create"]!(hn.ctx, { threadId: t.id, name: "Side helper", idempotencyKey: key() })).agentId as string;
  await h["threads.members.add"]!(hn.ctx, { threadId: t.id, personId: LEO });   // added to the thread directly
  assert.equal(on(grants, LEO, a).length, 1);
  await h["channels.leave"]!(hn.as({ kind: "person", id: LEO }), { channelId: ch.channelId });
  assert.equal(on(grants, LEO, a).length, 1, "an open channel's thread he can still read: he keeps it");
  assert.equal(hn.rows("SELECT * FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, LEO).length, 1, "and his place in it");
});

test("an archived channel never keeps someone in: the host takes a person and an agent out of it; anyone else is still told to bring it back first", async () => {
  const { hn } = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "old", visibility: "invite", memberIds: [LEO], idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  await h["channels.agents.add"]!(hn.ctx, { channelId: ch.channelId, agentId: INTAKE });
  await h["channels.archive"]!(hn.ctx, { channelId: ch.channelId });
  const refused = await h["channels.members.remove"]!(hn.ctx, { channelId: ch.channelId, personId: LEO }).then(() => "none", (e: { error?: { code?: string } }) => e.error?.code);
  assert.equal(refused, "validation.bad_input", "a person's own change to an archived channel is refused as before");
  const host = hn.as({ kind: "service", id: "svc_host" });
  await h["channels.members.remove"]!(host, { channelId: ch.channelId, personId: LEO });
  await h["channels.agents.remove"]!(host, { channelId: ch.channelId, agentId: INTAKE });
  assert.equal(hn.rows("SELECT * FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ch.mainThreadId, LEO).length, 0, "Leo is out of the archived channel");
  assert.equal(hn.rows("SELECT * FROM chat_thread_agent WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", ch.mainThreadId, INTAKE).length, 0, "and so is the agent");
});
