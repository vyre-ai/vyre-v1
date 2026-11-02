// Release gate: a newly invited member's first hour on a Vyre Server Space, part 2 of 3 (chats). Two people invited by email join (Aina by password in Chrome, Bilal with Google in the Windows
// app) and sign in again (test/support/member-hour.ts twoMembers). Then: a key the agent asks for in Aina's chat is added from the card by Aina and used by its handle on the agent's next turn, in
// the team Space and again in Aina's own Personal Space; a direct message makes Bilal's sidebar unread until he opens it; a private channel the owner makes and adds Bilal to opens for him and
// takes his post. Every Space label is the name, and nothing their screens asked was refused unless meant. Part 1 is sign-in and the Vault, part 3 is Inbox.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { addTheKey, bootHour, bootPersonal, connectClaude, messages, say, screen, spaceLabels, twoMembers, unexpectedRefusals, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

const SECRET = "fth_member_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
let h: Hour;
let a: Person;
let b: Person;

before(async () => {
  h = await bootHour("chats");
  // the owner keeps a Shared folder of team keys, as a firm does: a member's card must still find somewhere their key can go
  await h.owner.call("vault.folders.create", { name: "Team keys", scope: "shared" });
  ({ a, b } = await twoMembers(h));
});
after(async () => { await h?.stop(); });

/** The agent asks for the Fathom key in this person's chat; the card is there for them. Answers the chat and the request. */
async function cardAsked(hh: { d: Hour["d"] }, p: Person, agentId: string): Promise<{ threadId: string; requestId: string }> {
  const threadId = (await p.call("chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
  assert.equal(await say(hh as Hour, p, threadId, "please set up fathom", agentId), "I asked for the Fathom key.");
  const card = (await messages(hh as Hour, p, threadId)).flatMap((m) => m.blocks ?? []).find((x) => x.type === "vault_request");
  assert.ok(card, "the card is in the chat");
  return { threadId, requestId: card.data.requestId as string };
}

/** Once the key is in, the agent carries on in that chat by itself and uses that very item by its handle; the value is in no message. */
async function carriesOn(hh: { d: Hour["d"] }, p: Person, threadId: string, itemId: string): Promise<void> {
  const used = await waitFor(async () => (await messages(hh as Hour, p, threadId)).find((m) => m.author?.kind === "agent" && /^(USED|FAILED)/.test(m.body ?? ""))?.body ?? null, 20_000, "the agent carries on");
  assert.match(used, new RegExp(`^USED #Fathom(_\\d+)? ${itemId}$`), "the agent used that very item");
  assert.ok(!JSON.stringify(await messages(hh as Hour, p, threadId)).includes(SECRET), "the key never reaches a message or a block");
}

test("5 a key the agent asks for in Aina's chat shows on her card, and when the owner adds it for the team the agent uses it by its handle", async () => {
  // Aina's card reads the request and whether she can add it (keyrequest.tsx); she leaves it, and the owner adds it from Needs you into the team's folder
  const team = await cardAsked(h, a, h.agentId);
  assert.equal((await a.call("vault.requests.get", { requestId: team.requestId })).request.state, "waiting");
  assert.ok(((await a.call("vault.requests.list", { mine: false })).requests as Array<{ id: string }>).some((r) => r.id === team.requestId), "her card would take the key from her too");
  const row = ((await h.owner.call("tasks.list", { scope: "mine", kinds: ["unblock"], states: ["todo", "doing"] })).tasks as Array<{ title: string; workingNotes: Record<string, string> }>).find((t) => t.title === "Fathom key needed");
  assert.equal(row?.workingNotes["thread"], team.threadId, "the owner's Needs you row links Aina's chat");
  const keys = ((await h.owner.call("vault.folders.list", { scope: "shared" })).folders as Array<{ id: string; name: string }>).find((f) => f.name === "Team keys")!.id;
  const teamItem = (await h.owner.call("vault.requests.fulfil", { requestId: team.requestId, folderId: keys, fields: [{ key: "api_key", value: SECRET }] })).request as { state: string; itemId: string };
  assert.equal(teamItem.state, "fulfilled");
  await carriesOn(h, a, team.threadId, teamItem.itemId);
  assert.equal((await a.call("vault.requests.get", { requestId: team.requestId })).request.state, "fulfilled", "Aina's card turns to Added");
});

test("5b in the team Space Bilal adds his own key from his card into his Mine, the owner's row closes, and the agent uses his key, not the team's of the same name, on his turns only (owner ruling 3 Nov)", async () => {
  const own = await cardAsked(h, b, h.agentId);
  const added = await addTheKey(b, own.requestId, SECRET.replace("member", "bilal"));
  assert.deepEqual([added.canDecide, added.request?.state], [true, "fulfilled"], "Add the key on his own card");
  const item = (await b.call("vault.item.get", { itemId: added.request.itemId })).item as { scope: string; owner: string };
  assert.deepEqual([item.scope, item.owner], ["mine", b.personId], "it went into his own Mine, though the card offered the team's folder");
  await carriesOn(h, b, own.threadId, added.request.itemId);
  await h.d.hooks?.pump?.();
  const open = ((await h.owner.call("tasks.list", { scope: "mine", kinds: ["unblock"], states: ["todo", "doing"] })).tasks as Array<{ title: string }>).filter((t) => t.title === "Fathom key needed");
  assert.deepEqual(open, [], "the owner's Needs you row for it closed");
  // nobody else reaches it: not Aina, not the agent working for Aina
  await a.refused("vault.item.get", { itemId: added.request.itemId }, /^(permission|validation)\./, "Bilal's own key is his");
  assert.equal(await say(h, a, (await a.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string, "Carry on", h.agentId).then((x) => x.includes(added.request.itemId)), false, "the agent working for Aina never uses Bilal's key");
});

test("7 a DM from Aina makes Bilal's sidebar unread; opening it clears it; Aina never sees her own message as unread", async () => {
  const threadId = (await a.call("chat.start", { kind: "chat", agentIds: [], personId: b.personId })).thread.threadId as string;
  await a.call("chat.post", { threadId, body: "Welcome aboard, Bilal." });
  await h.d.hooks?.pump?.();
  type Row = { threadId: string; unread: number };
  const row = async (p: Person): Promise<Row | undefined> => {
    const r = await screen(p, "chats.sidebar", "recent", { filter: "all" });
    return [...r.starred, ...r.today, ...r.yesterday, ...r.earlier].find((x: Row) => x.threadId === threadId);
  };
  assert.ok(((await row(b))?.unread ?? 0) > 0, "Bilal's sidebar shows the DM unread");
  assert.ok((await b.call("spaces.switcher")).unread > 0, "and the Space tile has a dot");
  assert.equal((await row(a))?.unread ?? 0, 0, "Aina's own message is not unread for her");
  for (const q of ["thread", "messages", "helpers"]) await screen(b, "chats.conversation", q, { threadId });
  await b.call("threads.mark_read", { threadId });
  assert.equal((await row(b))?.unread ?? 0, 0, "opening it clears it");
});

test("8 a private channel the owner makes and adds Bilal to opens for him, and takes his post", async () => {
  const made = (await h.owner.call("channels.create", { name: "intake", visibility: "invite" })).channel as { channelId: string; mainThreadId: string };
  await h.owner.call("chat.post", { threadId: made.mainThreadId, body: "Intake starts here." });
  // before he is added it is not his to open, and he is told so in plain words (the sweep below accepts this refusal and no other)
  await b.refused("threads.get", { threadId: made.mainThreadId }, /^(permission|validation)\./, "a private channel is not his before he is added");
  await h.owner.call("channels.members.add", { channelId: made.channelId, personIds: [b.personId] });
  const listed = (await screen(b, "chats.sidebar", "channels", {})).channels as Array<{ channelId: string; name: string }>;
  assert.ok(listed.some((c) => c.channelId === made.channelId && c.name === "intake"), `Bilal's sidebar lists the channel: ${JSON.stringify(listed)}`);
  // the pane opens the channel by its main thread (ChatsMounted resolves chn_ through channels.get), and every read it makes answers
  const threadId = (await b.call("channels.get", { channelId: made.channelId })).channel.mainThreadId as string;
  assert.equal(threadId, made.mainThreadId);
  for (const q of ["thread", "messages", "helpers"]) assert.ok(await screen(b, "chats.conversation", q, { threadId }), `Bilal's channel pane ${q}`);
  await b.call("chat.post", { threadId, body: "Thanks, I am in." });
  const seen = (await messages(h, h.owner, threadId)).map((m) => m.body);
  assert.deepEqual(seen.filter((x) => x === "Intake starts here." || x === "Thanks, I am in."), ["Intake starts here.", "Thanks, I am in."]);
  // Aina was not added: the channel is not in her sidebar
  const hers = (await screen(a, "chats.sidebar", "channels", {})).channels as Array<{ channelId: string }>;
  assert.ok(!hers.some((c) => c.channelId === made.channelId), "a private channel is not in Aina's sidebar");
});

test("9 every Space label the app shows them is the name, never an spc_ id", async () => {
  for (const p of [a, b]) await spaceLabels(p);
});

test("10 no call their screens made was refused unless it was meant and said in plain words", () => {
  assert.deepEqual(unexpectedRefusals(h, [a, b]), []);
});

// last, because a second daemon in this process is stopped at its end
test("5c in her own Personal Space on her computer the same person adds the key from the card herself, and the agent uses it by its handle", async () => {
  // she is the owner of her Personal Space, so the card takes the key from her
  const mine = await bootPersonal("personal", a);
  try {
    await connectClaude(mine.me, "Aina_Claude");
    const agentId = (await mine.me.call("agents.create", { name: "Spark", role: "You help me." })).agent.agentId as string;
    const own = await cardAsked({ d: mine.d }, mine.me, agentId);
    const added = await addTheKey(mine.me, own.requestId, SECRET);
    assert.deepEqual([added.canDecide, added.request.state], [true, "fulfilled"], "Add the key on her own card");
    await carriesOn({ d: mine.d }, mine.me, own.threadId, added.request.itemId);
  } finally { await mine.stop(); }
});
