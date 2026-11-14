// chats.sidebar, chats.presence, engine.thread_states and notifications.unseen_by_thread on a booted daemon, asked by the owner, a member and a guest: the answers differ by who asks. The member never sees the owner's private chat,
// a guest gets only the channel they were added to (no goals, team or agents), a chat the caller may not open is absent from the engine's states, and nobody reads another person's mentions.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let m: Person;
let b: Person;
let g: Person;
let ainaChat = "";
let benChat = "";
let ainaAgent = "";
let ownerGoal = "";
let ainaMuted = "";
let privateThread = "";
let sharedChannel = "";
let guestChannel = "";
let guestChannelThread = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

before(async () => {
  h = await bootHour("sidebar-asker");
  m = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, m, await invite(h, m.email), { device: "web" });
  b = h.person("Ben", "ben", "ben@firm.test", "ben horse battery staple 9");
  await join(h, b, await invite(h, b.email), { device: "web" });
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Guest")!.id,
    email: "gus@firm.test",
  });
  g = h.person("Gus", "gus", "gus@firm.test", "gus horse battery staple 9");
  await join(h, g, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
  // the owner's private chat with the Space's agent, a public channel everyone is in, and a room the guest was added to
  const started = await h.owner.call("chat.start", {
    kind: "chat",
    agentIds: [h.agentId],
    idempotencyKey: "side-private",
  });
  privateThread = started.thread.threadId as string;
  await h.owner.call("chat.post", {
    threadId: privateThread,
    body: "owner's private words",
    idempotencyKey: "side-private-post",
  });
  sharedChannel = (await h.owner.call("channels.create", { name: "all-hands", visibility: "public" })).channel
    .channelId as string;
  await m.call("channels.join", { channelId: sharedChannel });
  const room = (await h.owner.call("channels.create", { name: "client-room", visibility: "invite" })).channel;
  guestChannel = room.channelId as string;
  guestChannelThread = room.mainThreadId as string;
  await h.owner.call("channels.members.add", { channelId: guestChannel, personIds: [g.personId] });
  await b.call("channels.join", { channelId: sharedChannel });
  // a private chat of each member, an agent only Aina may use, a pinned and a muted chat of hers, a goal only the owner has
  ainaAgent = (await m.call("agents.create", { name: "Aina's helper", role: "Helps Aina." })).agent.agentId as string;
  ainaChat = (await m.call("chat.start", { kind: "chat", agentIds: [ainaAgent], idempotencyKey: "aina-chat" })).thread
    .threadId as string;
  await m.call("chat.post", { threadId: ainaChat, body: "Aina's own words", idempotencyKey: "aina-post" });
  benChat = (await b.call("chat.start", { kind: "chat", agentIds: [h.agentId], idempotencyKey: "ben-chat" })).thread
    .threadId as string;
  await b.call("chat.post", { threadId: benChat, body: "Ben's own words", idempotencyKey: "ben-post" });
  await m.call("stars.toggle", { resource: { type: "thread", id: ainaChat }, on: true });
  ainaMuted = (await m.call("chat.start", { kind: "chat", agentIds: [ainaAgent], idempotencyKey: "aina-chat-2" }))
    .thread.threadId as string;
  await m.call("chat.post", { threadId: ainaMuted, body: "muted words", idempotencyKey: "aina-post-2" });
  await m.call("notifications.mute.set", { target: { kind: "thread", id: ainaMuted } });
  const goal = await h.owner.call("goals.create", {
    title: "Owner only goal",
    finish: { kind: "owner", line: "The owner says it is done" },
    deadline: Date.now() + 30 * 86_400_000,
    leadAgentId: h.agentId,
  });
  ownerGoal = goal.goal.id as string;
});
after(async () => {
  await h?.stop();
});

const keysOf = (out: Any): string[] =>
  ["goals", "pinned", "chats", "channels", "team"].flatMap((s) => (out[s].rows as { key: string }[]).map((r) => r.key));

test("the owner sees their private chat and both channels; the answer carries every section", async () => {
  const out: Any = await h.owner.call("chats.sidebar", {});
  const keys = keysOf(out);
  assert.ok(keys.includes(`c:${privateThread}`), "the owner's private chat");
  assert.ok(keys.includes(`ch:${sharedChannel}`) && keys.includes(`ch:${guestChannel}`));
  assert.equal(typeof out.rail, "number");
});

test("a member never sees the owner's private chat or its words, and does see the public channel and the team", async () => {
  const out: Any = await m.call("chats.sidebar", {});
  const keys = keysOf(out);
  assert.ok(!keys.includes(`c:${privateThread}`), "not the owner's private chat");
  assert.ok(!JSON.stringify(out).includes("owner's private words"));
  assert.ok(keys.includes(`ch:${sharedChannel}`), "the public channel");
  assert.ok(!keys.includes(`ch:${guestChannel}`), "not an invite-only room she is not in");
  assert.ok(out.team.total > 0, "the team");
  assert.ok(
    out.team.rows.some((r: { personId?: string }) => r.personId === h.owner.personId),
    "the owner is in her team",
  );
});

test("a guest gets only the channel they were added to: no public channel, no goals, no team, no agents", async () => {
  const out: Any = await g.call("chats.sidebar", {});
  const keys = keysOf(out);
  const own = ((await g.call("channels.list", {})).channels as { channelId: string }[])
    .map((c) => `ch:${c.channelId}`)
    .sort();
  assert.deepEqual(
    keys.filter((k) => k.startsWith("ch:")).sort(),
    own,
    "exactly the channels the guest may list themselves",
  );
  assert.ok(keys.includes(`ch:${guestChannel}`));
  assert.ok(!keys.includes(`ch:${sharedChannel}`), "not the public channel they are not in");
  assert.ok(!keys.includes(`c:${privateThread}`));
  assert.equal(out.goals.total, 0);
  assert.equal(out.team.total, 0);
  assert.equal(out.team.rows.length, 0);
});

test("three askers, three different answers", async () => {
  const [o, a, b] = (await Promise.all([
    h.owner.call("chats.sidebar", {}),
    m.call("chats.sidebar", {}),
    g.call("chats.sidebar", {}),
  ])) as Any[];
  const sig = (x: Any): string => keysOf(x).sort().join(",");
  assert.notEqual(sig(o), sig(a));
  assert.notEqual(sig(a), sig(b));
  assert.notEqual(sig(o), sig(b));
});

test("an unknown filter is refused in plain words, as a person asks", async () => {
  const e = await m.refused("chats.sidebar", { filter: "bananas" }, /^validation\./, "an unknown filter");
  assert.match(String(e.message), /not a way to filter the sidebar/);
});

test("the engine's chat states leave out a chat the asker may not open: the same answer as a chat with no turn", async () => {
  const owner: Any = await h.owner.call("engine.thread_states", { threadIds: [privateThread, guestChannelThread] });
  const member: Any = await m.call("engine.thread_states", { threadIds: [privateThread, guestChannelThread] });
  const guest: Any = await g.call("engine.thread_states", { threadIds: [privateThread, guestChannelThread] });
  const ids = (x: Any): string[] => (x.states as { threadId: string }[]).map((s) => s.threadId);
  assert.ok(
    !ids(member).includes(privateThread),
    "a member may not open the owner's private chat, and is told nothing of its turns",
  );
  assert.ok(!ids(guest).includes(privateThread), "nor a guest");
  assert.ok(
    !JSON.stringify(member).includes(privateThread) && !JSON.stringify(guest).includes(privateThread),
    "the id is not even echoed",
  );
  void owner;
});

test("a person's mentions are their own: each asker gets only their own unseen mentions", async () => {
  const mine: Any = await m.call("notifications.unseen_by_thread", {});
  const theirs: Any = await g.call("notifications.unseen_by_thread", {});
  assert.ok(Array.isArray(mine.counts) && Array.isArray(theirs.counts));
  assert.ok(!(theirs.counts as { threadId: string }[]).some((c) => c.threadId === privateThread));
});

test("presence: a guest gets nobody, and no one gets an agent's chat title", async () => {
  const guest: Any = await g.call("chats.presence", {});
  assert.deepEqual(guest.people, [], "a guest has no team");
  assert.deepEqual(guest.working, [], "and sees no agent at work");
  const gm: Any = await g.call("notifications.unseen_by_thread", {});
  assert.deepEqual(gm.counts, [], "a guest with no mention has no count, and none for a thread they cannot open");
  const member: Any = await m.call("chats.presence", {});
  assert.ok(!JSON.stringify(member).includes("owner's private words"));
});

const rowsOf = (out: Any, section: string): { key: string; title: string }[] =>
  out[section].rows as { key: string; title: string }[];
const everything = (out: Any): string => JSON.stringify(out);

test("each caller's answer holds exactly their own: not a row, a name or a count of the others'", async () => {
  const [o, a, bn, gu] = (await Promise.all([
    h.owner.call("chats.sidebar", {}),
    m.call("chats.sidebar", {}),
    b.call("chats.sidebar", {}),
    g.call("chats.sidebar", {}),
  ])) as Any[];
  // Aina: her chats only, not Ben's, not the owner's
  const aKeys = keysOf(a);
  assert.ok(
    aKeys.includes(`c:${ainaChat}`) || rowsOf(a, "pinned").some((r) => r.key === `c:${ainaChat}`),
    "Aina has her chat",
  );
  for (const x of [a, bn, gu])
    assert.ok(
      !everything(x).includes("owner's private words") && !everything(x).includes("Owner only goal"),
      "nothing of the owner's",
    );
  assert.ok(
    !everything(a).includes("Ben's own words") && !keysOf(a).includes(`c:${benChat}`),
    "nothing of Ben's in Aina's",
  );
  assert.ok(
    !everything(bn).includes("Aina's own words") &&
      !keysOf(bn).includes(`c:${ainaChat}`) &&
      !keysOf(bn).includes(`c:${ainaMuted}`),
    "nothing of Aina's in Ben's",
  );
  const benAgents = ((await b.call("agents.list", {})).agents as { agentId: string }[]).map((x) => x.agentId);
  const teamAgents = (x: Any): string[] =>
    (x.team.rows as { agentId?: string }[]).flatMap((r) => (r.agentId ? [r.agentId] : []));
  assert.deepEqual(
    teamAgents(bn).sort(),
    benAgents.sort(),
    "Ben's team agents are exactly the agents the product lists for Ben",
  );
  for (const [who, x] of [["the guest", gu]] as const)
    assert.ok(
      !everything(x).includes(ainaAgent),
      `Aina's own agent is not in ${who}'s answer: ${everything(x).slice(everything(x).indexOf(ainaAgent) - 120, everything(x).indexOf(ainaAgent) + 80)}`,
    );
  assert.ok(everything(a).includes(ainaAgent), "but it is in hers");
  // the owner's goal is the owner's
  assert.ok(
    rowsOf(o, "goals")
      .concat(rowsOf(o, "pinned"))
      .some((r) => r.key === `g:${ownerGoal}`),
    "the owner sees their goal",
  );
  for (const x of [a, bn, gu]) assert.ok(!keysOf(x).includes(`g:${ownerGoal}`), "nobody else sees it");
  // the private channel the guest was added to is not in a member's answer
  assert.ok(!keysOf(a).includes(`ch:${guestChannel}`) && !keysOf(bn).includes(`ch:${guestChannel}`));
});

test("totals, the rail and the next unread count only what the caller may open: no hidden chat makes a number bigger", async () => {
  const [a, bn, gu] = (await Promise.all([
    m.call("chats.sidebar", {}),
    b.call("chats.sidebar", {}),
    g.call("chats.sidebar", {}),
  ])) as Any[];
  // the total of Chats is what the person's own chat list holds
  const mineRecent = async (p: Person): Promise<number> => {
    const r: Any = await p.call("chat.recent", {});
    return ["starred", "today", "yesterday", "earlier"]
      .flatMap((k) => r[k] as { kind: string; threadId: string }[])
      .filter((x) => x.kind === "chat").length;
  };
  const inPinned = (x: Any): number => (x.pinned.rows as unknown[]).length;
  assert.equal(bn.chats.total + inPinned(bn), await mineRecent(b), "Ben's total is Ben's chats");
  assert.equal(
    a.chats.total + inPinned(a),
    (await mineRecent(m)) - 0 - (a.team.rows as { threadId?: string }[]).filter((r) => r.threadId).length,
    "Aina's total is hers (a one-to-one is a team row)",
  );
  assert.equal(gu.chats.total, 0, "a guest's total does not tell how many private chats exist");
  assert.equal(gu.goals.total, 0);
  assert.equal(gu.team.total, 0);
  // the rail is what is addressed to the person: a guest with nothing waiting reads 0, not the Space's number
  assert.equal(gu.rail, 0);
  // the owner posts in the public channel: Aina and Ben are in it and may see it; the guest is not and nextUnread never names it
  await h.owner.call("chat.post", {
    threadId: (await h.owner.call("channels.get", { channelId: sharedChannel })).channel.mainThreadId,
    body: "hello all",
    idempotencyKey: "all-hands-1",
  });
  const gu2: Any = await g.call("chats.sidebar", {});
  assert.notEqual(gu2.nextUnread, `ch:${sharedChannel}`);
  assert.equal(
    gu2.nextUnread === undefined || String(gu2.nextUnread).startsWith("ch:") || String(gu2.nextUnread).startsWith("c:"),
    true,
  );
  assert.ok(!keysOf(gu2).includes(`ch:${sharedChannel}`));
});

test("a pin and a mute are the caller's own: Aina's pinned chat is first in her Pinned and in nobody's else; her mute shows only for her", async () => {
  const [a, bn, o] = (await Promise.all([
    m.call("chats.sidebar", {}),
    b.call("chats.sidebar", {}),
    h.owner.call("chats.sidebar", {}),
  ])) as Any[];
  assert.deepEqual(
    rowsOf(a, "pinned").map((r) => r.key),
    [`c:${ainaChat}`],
  );
  assert.equal((a.pinned.rows as { pinned: number }[])[0]!.pinned, 0);
  assert.equal(bn.pinned.total, 0);
  assert.equal(o.pinned.total, 0);
  const muted = (a.chats.rows as { key: string; muted: boolean }[]).find((r) => r.key === `c:${ainaMuted}`);
  assert.equal(muted?.muted, true, "her muted chat says muted");
  assert.ok(!everything(bn).includes(ainaMuted) && !everything(o).includes(ainaMuted));
});

test("a goal that goes stuck is said once: the real Unblock task is in Tasks and the goal's own row carries no line (real goals, tasks and sidebar reads, no stubs)", async () => {
  const stuck = await h.owner.call("goals.mark_stuck", {
    goalId: ownerGoal,
    reason: "The registrations number has not moved",
    options: ["Raise the budget", "Move the deadline"],
  });
  assert.equal(stuck.goal.status, "stuck");
  const out = await h.owner.call("chats.sidebar", {});
  const need = (out.needs.items as { taskId: string; title: string; verb: string }[]).find(
    (n) => n.title === "Stuck: Owner only goal",
  );
  assert.ok(need, "the real Unblock task is in Needs you");
  const row = (out.goals.rows as Record<string, unknown>[]).find((r) => r["key"] === `g:${ownerGoal}`);
  assert.ok(row, "the goal is still a row");
  assert.equal(row!["line"], undefined, "and says nothing a second time");
  assert.equal(row!["nextCheckinAt"], undefined);
  // the task made by the real module names its goal
  const task = await h.owner.call("tasks.get", { taskId: need!.taskId });
  assert.deepEqual(task.task.source, { kind: "goal", id: ownerGoal });
});
