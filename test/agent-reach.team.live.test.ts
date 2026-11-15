// Who reaches an agent in a Team Space (owner, 15 Nov 2026), on a booted server daemon with the real access, agents, projects and chat modules. An agent nobody shared is its maker's; a project's
// teammate lives in its project (whoever reaches the project reaches it); an agent in a chat is reachable THERE by that chat's readers; a member's own new agent is hers until she shares it with named
// people; and every door says the same sentence ("That agent does not exist.") to someone who may not see an agent.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let bea: Person, cal: Person, dan: Person;
const GONE = "That agent does not exist.";

before(async () => {
  h = await bootHour("agentreach");
  bea = h.person("Bea", "bea", "bea@firm.test", "bea horse battery staple 9");
  cal = h.person("Cal", "cal", "cal@firm.test", "cal horse battery staple 9");
  dan = h.person("Dan", "dan", "dan@firm.test", "dan horse battery staple 9");
  for (const p of [bea, cal, dan]) await join(h, p, await invite(h, p.email), { device: "web" });
});
after(async () => {
  await h?.stop();
});

const may = async (who: Person, agentId: string, level = "use"): Promise<string> =>
  (
    (await h.owner.call("access.check", {
      principal: { kind: "person", id: who.personId },
      action: { level },
      resource: { type: "agent", id: agentId },
    })) as { decision: { effect: string } }
  ).decision.effect;
const refusal = async (p: Promise<{ ok: true; data: unknown } | { ok: false; error: unknown }>) => {
  const r = await p;
  assert.equal(r.ok, false, "it was refused");
  const e = (r as { error: { status: number; message: string; code?: string } }).error;
  return { status: e.status, message: e.message, code: e.code };
};
const listed = async (who: Person, input: Record<string, unknown> = {}): Promise<string[]> =>
  ((await who.call("agents.list", input)).agents as { agentId: string }[]).map((a) => a.agentId);
const make = async (who: Person, name: string, extra: Record<string, unknown> = {}): Promise<string> =>
  (
    (await who.call("agents.create", { name, role: "Help.", idempotencyKey: `ar-${name}`, ...extra })).agent as {
      agentId: string;
    }
  ).agentId;

test("A: a project's teammate is reached by the project's lead and members, not by a Space member outside it", async () => {
  const projectId = (
    await h.owner.call("projects.create", { type: "project", title: "Portal", idempotencyKey: "ar-prj" })
  ).projectId as string;
  await h.owner.call("projects.members.set", {
    projectId,
    principal: bea.personId,
    role: "lead",
    idempotencyKey: "ar-m1",
  });
  await h.owner.call("projects.members.set", {
    projectId,
    principal: cal.personId,
    role: "member",
    idempotencyKey: "ar-m2",
  });
  // the two ways a teammate is made
  const viaCreate = await make(h.owner, "Reviewer", { projectId });
  const viaTeammates = (
    (await h.owner.call("projects.teammates.create", {
      projectId,
      name: "Scribe",
      role: "member",
      idempotencyKey: "ar-tm",
    })) as { teammate: { agentId: string } }
  ).teammate.agentId;
  for (const [label, agentId] of [
    ["agents.create", viaCreate],
    ["projects.teammates.create", viaTeammates],
  ] as const) {
    for (const who of [bea, cal]) {
      assert.equal(await may(who, agentId), "allow", `${label}: ${who.label} may use the project's teammate`);
      assert.ok((await listed(who, { projectId })).includes(agentId), `${label}: (i) ${who.label} lists it`);
      assert.equal((await who.attempt("agents.get", { agentId })).ok, true, `${label}: (ii) ${who.label} opens it`);
    }
    const chat = await bea.attempt("chat.start", {
      kind: "chat",
      agentIds: [agentId],
      idempotencyKey: `ar-chat-${agentId}`,
    });
    assert.equal(chat.ok, true, `${label}: (iii) the lead starts a chat with it`);
    // a Space member outside the project reaches its teammate exactly as far as the project itself (the Member role's Space grant reaches this project, and so its teammate: nothing is copied)
    const projectReach = (
      (await h.owner.call("access.check", {
        principal: { kind: "person", id: dan.personId },
        action: { level: "use" },
        resource: { type: "project", id: projectId },
      })) as { decision: { effect: string } }
    ).decision.effect;
    assert.equal(await may(dan, agentId), projectReach, `${label}: Dan reaches the teammate as he reaches the project`);
  }
  // (iv) the lead names the teammate in the project's own chat
  const channelId = ((await h.owner.call("projects.get", { projectId })) as { project: { channelId?: string } }).project
    .channelId;
  if (channelId) {
    const main = ((await bea.call("channels.get", { channelId })) as { channel: { mainThreadId: string } }).channel
      .mainThreadId;
    const said = await bea.attempt("chat.post", {
      threadId: main,
      body: "hello",
      mentions: [{ kind: "agent", id: viaTeammates }],
      idempotencyKey: "ar-ment",
    });
    assert.equal(said.ok, true, "(iv) the lead @-mentions the teammate in the project's channel");
  }
});

test("B: an agent in a chat is reachable there by that chat's readers, and nowhere else", async () => {
  const wren = await make(h.owner, "Wren", { sharing: "me" });
  assert.notEqual(await may(bea, wren), "allow", "nobody shared Wren with Bea");
  const ch = (
    (await h.owner.call("channels.create", {
      name: "open-room",
      visibility: "public",
      memberIds: [bea.personId],
      idempotencyKey: "ar-room",
    })) as { channel: { channelId: string; mainThreadId: string } }
  ).channel;
  await h.owner.call("channels.agents.add", { channelId: ch.channelId, agentId: wren, idempotencyKey: "ar-add" });
  const said = await bea.attempt("chat.post", {
    threadId: ch.mainThreadId,
    body: "hi Wren",
    mentions: [{ kind: "agent", id: wren }],
    idempotencyKey: "ar-bea-says",
  });
  assert.equal(said.ok, true, "Bea asks Wren in the channel she reads");
  assert.ok(!(await listed(bea)).includes(wren), "Wren is not offered in Bea's lists");
  const one = await refusal(bea.attempt("chat.start", { kind: "chat", agentIds: [wren], idempotencyKey: "ar-one" }));
  assert.equal(one.message, GONE, "no one-to-one chat with it");
  const page = await refusal(bea.attempt("agents.get", { agentId: wren }));
  assert.equal(page.message, GONE, "its page is not hers");
  // what she may not use she cannot bring into a channel of her own
  const mine = (
    (await bea.call("channels.create", {
      name: "bea-room",
      visibility: "public",
      memberIds: [],
      idempotencyKey: "ar-room2",
    })) as { channel: { channelId: string } }
  ).channel;
  const add = await refusal(
    bea.attempt("channels.agents.add", { channelId: mine.channelId, agentId: wren, idempotencyKey: "ar-add2" }),
  );
  assert.equal(add.message, GONE, "adding an agent she cannot see reads as one that does not exist");
});

test("C: a member's own new agent is hers; she shares it with named people, not with Everyone", async () => {
  const beas = await make(bea, "BeaBot");
  assert.equal(await may(bea, beas), "allow");
  assert.notEqual(await may(cal, beas), "allow", "born the maker's own: a member cannot share with Everyone by hand");
  assert.ok(!(await listed(cal)).includes(beas));
  await bea.call("access.share", {
    resource: { type: "agent", id: beas },
    subject: { kind: "person", id: cal.personId },
    level: "use",
  });
  assert.equal(await may(cal, beas), "allow", "named people she shares it with reach it");
  assert.notEqual(await may(dan, beas), "allow");
  const everyone = await refusal(
    bea.attempt("access.share", {
      resource: { type: "agent", id: beas },
      subject: { kind: "group", id: "grp_everyone" },
      level: "use",
    }),
  );
  assert.match(everyone.message, /admin/i);
  // an agent the owner (who may share with Everyone) makes is born shared
  const teams = await make(h.owner, "TeamBot");
  assert.equal(await may(dan, teams), "allow");
});

test("D: after the update an agent the owner made stays usable by members and one a member made is hers; an agent nobody shared is its maker's, and sharing it again opens it", async () => {
  // what the update leaves (the one-time pass, host/src/gateway/principals.ts oldAgentShareEvents, writes the owner's old agents the grant a new one is born with): the owner's agent is a member's to use, a plain member's is her own
  assert.equal(
    h.d.db!.all(`SELECT 1 FROM host_passes WHERE "key" = 'agent-birth-share'`).length,
    1,
    "the one-time pass ran at the first start and left its marker",
  );
  const ownersOld = await make(h.owner, "OwnersOld");
  assert.equal(await may(dan, ownersOld), "allow", "an agent the owner made is still usable by a member");
  const membersOld = await make(bea, "MembersOld");
  assert.notEqual(await may(dan, membersOld), "allow", "an agent a plain member made is its maker's");
  assert.equal(await may(bea, membersOld), "allow");
  const old = await make(h.owner, "OldBot");
  await h.owner.call("access.unshare", {
    resource: { type: "agent", id: old },
    subject: { kind: "group", id: "grp_everyone" },
  });
  assert.notEqual(await may(dan, old), "allow");
  assert.ok(!(await listed(dan)).includes(old), "not in Dan's list");
  assert.equal(await may(h.owner, old, "manage"), "allow", "its maker keeps it");
  await h.owner.call("access.share", {
    resource: { type: "agent", id: old },
    subject: { kind: "group", id: "grp_everyone" },
    level: "use",
  });
  assert.equal(await may(dan, old), "allow");
});

test("F: every door says the same sentence about an agent the person may not see, and about one that is not there", async () => {
  const hidden = await make(h.owner, "Hidden", { sharing: "me" });
  const unknown = "agt_zzzzzzzzzzzzzzzz";
  const a = await refusal(dan.attempt("agents.get", { agentId: hidden }));
  const b = await refusal(dan.attempt("agents.get", { agentId: unknown }));
  assert.deepEqual([a.status, a.message], [b.status, b.message]);
  assert.equal(a.message, GONE);
  assert.doesNotMatch(a.message, /agt_|access/i, "no id and no Ask for access");
  const c = await refusal(dan.attempt("chat.start", { kind: "chat", agentIds: [hidden], idempotencyKey: "ar-f1" }));
  assert.equal(c.message, GONE, "chat.start with an agent Dan may not see says the same sentence");
  assert.equal(c.status, a.status);
});
