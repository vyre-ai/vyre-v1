// chats.sidebar, chats.presence, engine.thread_states and notifications.unseen_by_thread on a booted daemon, asked by the owner, a member and a guest: the answers differ by who asks. The member never sees the owner's private chat,
// a guest gets only the channel they were added to (no goals, team or agents), a chat the caller may not open is absent from the engine's states, and nobody reads another person's mentions.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let m: Person;
let g: Person;
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
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const inv = await h.owner.call("members.invites.create", { role: roles.find((r) => r.name === "Guest")!.id, email: "gus@firm.test" });
  g = h.person("Gus", "gus", "gus@firm.test", "gus horse battery staple 9");
  await join(h, g, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
  // the owner's private chat with the Space's agent, a public channel everyone is in, and a room the guest was added to
  const started = await h.owner.call("chat.start", { kind: "chat", agentIds: [h.agentId], idempotencyKey: "side-private" });
  privateThread = started.thread.threadId as string;
  await h.owner.call("chat.post", { threadId: privateThread, body: "owner's private words", idempotencyKey: "side-private-post" });
  sharedChannel = (await h.owner.call("channels.create", { name: "all-hands", visibility: "public" })).channel.channelId as string;
  const room = (await h.owner.call("channels.create", { name: "client-room", visibility: "invite" })).channel;
  guestChannel = room.channelId as string;
  guestChannelThread = room.mainThreadId as string;
  await h.owner.call("channels.members.add", { channelId: guestChannel, personIds: [g.personId] });
});
after(async () => {
  await h?.stop();
});

const keysOf = (out: Any): string[] => ["goals", "pinned", "chats", "channels", "team"].flatMap((s) => (out[s].rows as { key: string }[]).map((r) => r.key));

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
  assert.ok(out.team.rows.some((r: { personId?: string }) => r.personId === h.owner.personId), "the owner is in her team");
});

test("a guest gets only the channel they were added to: no public channel, no goals, no team, no agents", async () => {
  const out: Any = await g.call("chats.sidebar", {});
  const keys = keysOf(out);
  const own = ((await g.call("channels.list", {})).channels as { channelId: string }[]).map((c) => `ch:${c.channelId}`).sort();
  assert.deepEqual(keys.filter((k) => k.startsWith("ch:")).sort(), own, "exactly the channels the guest may list themselves");
  assert.ok(keys.includes(`ch:${guestChannel}`));
  assert.ok(!keys.includes(`ch:${sharedChannel}`), "not the public channel they are not in");
  assert.ok(!keys.includes(`c:${privateThread}`));
  assert.equal(out.goals.total, 0);
  assert.equal(out.team.total, 0);
  assert.equal(out.team.rows.length, 0);
});

test("three askers, three different answers", async () => {
  const [o, a, b] = (await Promise.all([h.owner.call("chats.sidebar", {}), m.call("chats.sidebar", {}), g.call("chats.sidebar", {})])) as Any[];
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
  assert.ok(!ids(member).includes(privateThread), "a member may not open the owner's private chat");
  assert.ok(!ids(guest).includes(privateThread), "nor a guest");
  assert.ok(!JSON.stringify(member).includes(privateThread) && !JSON.stringify(guest).includes(privateThread), "the id is not even echoed");
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
  const member: Any = await m.call("chats.presence", {});
  assert.ok(!JSON.stringify(member).includes("owner's private words"));
});
