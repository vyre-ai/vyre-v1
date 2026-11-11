// Leaving or being taken out of a chat or a channel takes away, by the time the call returns, exactly what that membership gave: a person's view of the agents the chat made for itself, and an
// agent's grants from a channel it was taken out of. A grant held for another reason (a direct share, another chat) stays. The race between a person being added (its grants are still being
// written) and the same person being removed is held deterministically.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, LEO, harness as baseHarness } from "../fixtures/harness.ts";
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
