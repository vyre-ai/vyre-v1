// Channels (spec 2.5, 3.2 flows 8 and 9): create a room, make a private chat into one, connect an outside agent.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const create = (ctx: Harness["ctx"], input: Record<string, unknown>) => h["channels.create"]!(ctx, { name: "intake", visibility: "public", idempotencyKey: `c${++n}`, ...input });

test("a channel has a main thread, the creator as owner, listening agents and nothing unread", async () => {
  const hn = harness();
  const { channel } = await create(hn.ctx, { name: "  #Client   Intake ", topic: " New matters ", memberIds: [MAYA, MAYA, LEO], agentIds: [INTAKE, DRAFTER], folderId: "fld_c1" });
  assert.equal(channel.name, "Client Intake");
  assert.equal(channel.topic, "New matters");
  assert.equal(channel.visibility, "public");
  assert.equal(channel.archived, false);
  assert.equal(channel.unread, 0);
  assert.equal(channel.folderId, "fld_c1");
  assert.deepEqual(channel.members.map((m: any) => m.id), [DANA, MAYA, LEO]);
  assert.deepEqual(channel.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "listen"], [DRAFTER, "listen"]]);
  const main = hn.rows("SELECT * FROM chat_thread WHERE id = ?", channel.mainThreadId)[0]!;
  assert.equal(main["kind"], "channel");
  assert.equal(main["channelId"], channel.channelId);
  assert.equal(main["listed"], 1);
  assert.equal(main["folderId"], "fld_c1");
  assert.equal(hn.rows("SELECT role FROM chat_thread_member WHERE thread = ? AND principal = ?", channel.mainThreadId, DANA)[0]!["role"], "owner");
  assert.deepEqual(hn.names(), ["channel.created", "thread.started"]);
  assert.deepEqual(hn.named("channel.created")[0]!.payload, { channelId: channel.channelId, name: "Client Intake", visibility: "public" });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("channel names are unique the way people read them, and a record has one live channel", async () => {
  const hn = harness();
  await create(hn.ctx, { name: "Client Intake" });
  assert.equal(await failure(() => create(hn.ctx, { name: "client   intake" })), "validation.bad_input");
  assert.equal(await failure(() => create(hn.ctx, { name: "   " })), "validation.bad_input");
  assert.equal(await failure(() => create(hn.ctx, { name: "x".repeat(81) })), "validation.bad_input");
  assert.equal(await failure(() => create(hn.ctx, { name: "ok", topic: "t".repeat(251) })), "validation.bad_input");
  assert.equal(await failure(() => create(hn.ctx, { name: "ok", memberIds: [INTAKE] })), "validation.bad_input");
  assert.equal(await failure(() => create(hn.ctx, { name: "ok", agentIds: [MAYA] })), "validation.bad_input");

  const project = (await create(hn.ctx, { name: "Smith matter", visibility: "invite", recordId: "rec_p1" })).channel;
  assert.equal(project.recordId, "rec_p1");
  assert.equal(await failure(() => create(hn.ctx, { name: "Smith again", recordId: "rec_p1" })), "validation.bad_input");
  hn.raw.run("UPDATE chat_channel SET archived = 1 WHERE id = ?", project.channelId);
  assert.equal((await create(hn.ctx, { name: "Smith matter", recordId: "rec_p1" })).channel.recordId, "rec_p1", "an archived channel frees its name and its record");
  assert.equal(hn.rows("SELECT id FROM chat_thread WHERE kind = 'channel'").length, 3, "refused creations left nothing behind");
});

test("an agent that creates a channel for a person creates it as that person's", async () => {
  const hn = harness();
  const { channel } = await create(hn.agent(INTAKE, MAYA), { name: "from-agent" });
  assert.deepEqual(channel.members.map((m: any) => m.id), [MAYA]);
});

// ---- threads.make_channel ---------------------------------------------------------------------------------------------------------------------------

test("a private chat becomes a channel with another person, linked back, with the chat's agents listening", async () => {
  const hn = harness();
  const chat = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], title: "Smith intake", recordId: "rec_s1", folderId: "fld_s1", idempotencyKey: "k" })).thread;
  hn.clear();
  const { channel } = await h["threads.make_channel"]!(hn.ctx, { threadId: chat.threadId, personId: MAYA, idempotencyKey: "m1" });
  assert.equal(channel.name, "Smith intake");
  assert.equal(channel.visibility, "invite");
  assert.equal(channel.recordId, "rec_s1");
  assert.deepEqual(channel.members.map((m: any) => m.id), [DANA, MAYA]);
  assert.deepEqual(channel.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "listen"]], "in a channel the agent answers when it is @mentioned");
  const main = hn.rows("SELECT parentThreadId, kind FROM chat_thread WHERE id = ?", channel.mainThreadId)[0]!;
  assert.equal(main["parentThreadId"], chat.threadId, "the new channel links back to the chat");
  assert.equal(main["kind"], "channel");
  assert.deepEqual(hn.names(), ["channel.created", "thread.promoted"]);
  assert.deepEqual(hn.named("thread.promoted")[0]!.payload, { threadId: chat.threadId, channelId: channel.channelId, personId: MAYA });
  assert.deepEqual(assertEventsConform(hn), []);
  // the chat itself stays private: nobody joined it
  const after = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [DRAFTER], idempotencyKey: "k2" });
  assert.ok(after.thread.threadId);
  assert.deepEqual(hn.rows("SELECT principal FROM chat_thread_member WHERE thread = ?", chat.threadId).map((r) => r["principal"]), [DANA]);
});

test("a direct message with a third person becomes a channel with all three; names do not collide", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, title: "Launch", idempotencyKey: "k" })).thread;
  const a = (await h["threads.make_channel"]!(hn.ctx, { threadId: dm.threadId, personId: LEO, idempotencyKey: "m1" })).channel;
  assert.deepEqual(a.members.map((m: any) => m.id), [DANA, MAYA, LEO]);
  assert.equal(a.name, "Launch");
  const b = (await h["threads.make_channel"]!(hn.ctx, { threadId: dm.threadId, personId: LEO, idempotencyKey: "m2" })).channel;
  assert.equal(b.name, "Launch 2", "a default name finds a free one");
  assert.equal(await failure(() => h["threads.make_channel"]!(hn.ctx, { threadId: dm.threadId, personId: LEO, name: "launch", idempotencyKey: "m3" })), "validation.bad_input", "a name someone chose must be free");
  const c = (await h["threads.make_channel"]!(hn.ctx, { threadId: dm.threadId, personId: LEO, name: "Launch war room", idempotencyKey: "m4" })).channel;
  assert.equal(c.name, "Launch war room");
});

test("what cannot become a channel", async () => {
  const hn = harness();
  const chat = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k" })).thread;
  const ch = (await create(hn.ctx, { name: "room" })).channel;
  const bad = (threadId: string, personId: string, ctx: Harness["ctx"] = hn.ctx) => failure(() => h["threads.make_channel"]!(ctx, { threadId, personId, idempotencyKey: `m${++n}` }));
  assert.equal(await bad(chat.threadId, DANA), "validation.bad_input", "yourself");
  assert.equal(await bad(chat.threadId, INTAKE), "validation.bad_input", "an agent is not a person");
  assert.equal(await bad(ch.mainThreadId, MAYA), "validation.bad_input", "a channel is already one");
  assert.equal(await bad("thr_none", MAYA), "validation.bad_input");
  assert.equal(await bad(chat.threadId, LEO, hn.person(MAYA)), "validation.bad_input", "someone else's chat");
  const ask = (await h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a", idempotencyKey: "ka" })).thread;
  assert.equal(await bad(ask.threadId, MAYA), "validation.bad_input", "an Ask pane stays private");
});

// ---- channels.connect_outside_agent ----------------------------------------------------------------------------------------------------------------

test("connecting Claude Code or Codex asks MCP for a one-time token and returns the address and the command", async () => {
  const hn = harness();
  const { channel } = await create(hn.ctx, { name: "intake" });
  hn.clear();
  const cc = await h["channels.connect_outside_agent"]!(hn.ctx, { channelId: channel.channelId, name: "Claude Code", scopes: { read: true, post: true, readChangesets: true, writeBranch: false }, idempotencyKey: "o1" });
  assert.deepEqual(cc, {
    mcpUrl: "https://northwind.example.com/mcp", oneTimeToken: "otk_testtoken", expiresAt: 1_760_000_600_000,
    runCommand: "claude mcp add vyre https://northwind.example.com/mcp --token otk_testtoken",
  });
  assert.deepEqual(hn.callLog[0], {
    cap: "mcp.token.issue", input: { name: "Claude Code", kind: "claude_code", channelId: channel.channelId, scopes: { read: true, post: true, readChangesets: true, writeBranch: false }, idempotencyKey: "o1" },
  });
  const cx = await h["channels.connect_outside_agent"]!(hn.ctx, { channelId: channel.channelId, name: "Codex on my laptop", idempotencyKey: "o2" });
  assert.match(cx.runCommand, /^codex mcp add vyre /);
  assert.equal(hn.callLog[1]!.input["kind"], "codex");
  assert.equal("scopes" in hn.callLog[1]!.input, false, "no scopes given: MCP applies its defaults (read and post, no writes)");
  const other = await h["channels.connect_outside_agent"]!(hn.ctx, { channelId: channel.channelId, name: "Cursor", idempotencyKey: "o3" });
  assert.match(other.runCommand, /^mcp add vyre /);
  assert.equal(hn.callLog[2]!.input["kind"], "other");
  assert.deepEqual(hn.names(), [], "chat raises nothing itself: the audit row and mcp's token.issued tell the story");
});

test("a channel that does not exist or is archived takes no connection; a missing MCP is a clear failure", async () => {
  const hn = harness();
  const { channel } = await create(hn.ctx, { name: "intake" });
  const connect = (channelId: string, name = "Claude Code") => failure(() => h["channels.connect_outside_agent"]!(hn.ctx, { channelId, name, idempotencyKey: `o${++n}` }));
  assert.equal(await connect("chn_none"), "validation.not_found");
  assert.equal(await connect(channel.channelId, "  "), "validation.bad_input");
  assert.equal(await connect(channel.channelId, "x".repeat(121)), "validation.bad_input");
  hn.raw.run("UPDATE chat_channel SET archived = 1 WHERE id = ?", channel.channelId);
  assert.equal(await connect(channel.channelId), "validation.bad_input");
  assert.equal(hn.callLog.length, 0, "nothing was asked of MCP");

  const noMcp = harness({ calls: { "mcp.token.issue": () => { throw new Error("down"); } } });
  const c2 = (await create(noMcp.ctx, { name: "intake" })).channel;
  await assert.rejects(() => h["channels.connect_outside_agent"]!(noMcp.ctx, { channelId: c2.channelId, name: "Claude Code", idempotencyKey: "z" }), /down/);
});
