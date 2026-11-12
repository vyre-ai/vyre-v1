// The files folder of an agent a chat made follows that chat (lane f-revoke, 12 Nov 2026). For a chat closed to the Space (a private chat, a thread of an invite-only channel) the folder is cut
// off from the Space (access audience "added") and its readers hold it by grants of the chat's source; leaving takes them in the same call; the chat's audience changing (made public, made
// invite-only) moves the folder with it; a newcomer gets it; an open channel's agent keeps its folder open to the Space. The access calls are a fake that keeps grants and audiences.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, periodic } from "../impl.ts";
import { DANA, INTAKE, LEO, harness as baseHarness } from "../fixtures/harness.ts";
import { addMember, insertThread } from "../projections.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `of${++n}`;
const MIA = "usr_mia";

interface G { resource: { type: string; id: string }; subject: { kind: string; id: string }; level: string; source?: string }
function world(o: { audienceFails?: boolean } = {}) {
  const grants: G[] = [];
  const audience = new Map<string, string>();
  const deleted: string[] = [];
  let made = 0;
  const hn = baseHarness({
    calls: {
      "agents.get": (i) => ({ agent: { agentId: i["agentId"], name: String(i["agentId"]), runtime: "vyre", folderId: `fld_${String(i["agentId"])}` } }),
      "access.principals.get": () => ({ principal: { name: "Someone" } }),
      "agents.create": () => ({ agent: { agentId: `agt_made${++made}` } }),
      "agents.delete": (i) => { deleted.push(String(i["agentId"])); return { deleted: true }; },
      "engine.set_mode": (i) => ({ mode: i["mode"], leadAgentId: null }),
      "engine.stop_all": () => ({ stopped: 0 }),
      "files.resolve": () => { throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); },
      "access.audience_set": (i) => {
        if (o.audienceFails) throw Object.assign(new Error("refused"), { error: { code: "permission.no_grant" } });
        const r = i["resource"] as { type: string; id: string };
        audience.set(r.id, String(i["audience"]));
        return { audience: i["audience"] };
      },
      "access.share": (i) => {
        const g = { resource: i["resource"], subject: i["subject"], level: String(i["level"]), ...(i["source"] ? { source: String(i["source"]) } : {}) } as G;
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
  return { hn, grants, audience, deleted };
}
const folderOf = (grants: G[], who: string, agentId: string): G[] => grants.filter((g) => g.subject.id === who && g.resource.type === "folder" && g.resource.id === `fld_${agentId}`);
const agentOf = (grants: G[], who: string, agentId: string): G[] => grants.filter((g) => g.subject.id === who && g.resource.type === "agent" && g.resource.id === agentId);

async function inviteThread(w: ReturnType<typeof world>) {
  const ch = (await h["channels.create"]!(w.hn.ctx, { name: "legal", visibility: "invite", memberIds: [LEO], idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  const t = insertThread(w.hn.ctx, { kind: "chat", title: "T", starter: DANA, listed: true, channelId: ch.channelId, parentThreadId: ch.mainThreadId });
  addMember(w.hn.ctx, t.id, DANA, "owner");
  addMember(w.hn.ctx, t.id, LEO);
  const a = (await h["threads.agent.create"]!(w.hn.ctx, { threadId: t.id, name: "T helper", idempotencyKey: key() })).agentId as string;
  return { ch, t, a };
}

test("an agent made in a thread of an invite-only channel: its folder is cut off from the Space, and the channel's people hold it at Edit by the thread's grant", async () => {
  const w = world();
  const { t, a } = await inviteThread(w);
  assert.equal(w.audience.get(`fld_${a}`), "added", "the folder is open only to people added");
  for (const who of [DANA, LEO]) assert.deepEqual(folderOf(w.grants, who, a).map((g) => [g.level, g.source]), [["edit", `chat:${t.id}`]], `${who} reads it as a reader of the thread`);
  assert.equal(w.grants.some((g) => g.resource.type === "folder" && g.subject.kind === "group"), false, "no group is given the folder");
});

test("taken out of the channel: the folder goes in the same call; a share of the folder by hand stays", async () => {
  const w = world();
  const { ch, a } = await inviteThread(w);
  w.grants.push({ resource: { type: "folder", id: `fld_${a}` }, subject: { kind: "person", id: LEO }, level: "view", source: "direct" });
  await h["channels.members.remove"]!(w.hn.ctx, { channelId: ch.channelId, personId: LEO });
  assert.deepEqual(folderOf(w.grants, LEO, a).map((g) => g.source), ["direct"], "only what the thread gave is gone");
  assert.deepEqual(agentOf(w.grants, LEO, a), [], "and the agent with it");
  assert.equal(folderOf(w.grants, DANA, a).length, 1, "the one still in keeps it");
});

test("an agent made in an open channel keeps its folder open to the Space, and no one is given the folder", async () => {
  const w = world();
  const ch = (await h["channels.create"]!(w.hn.ctx, { name: "open", visibility: "public", idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  const a = (await h["threads.agent.create"]!(w.hn.ctx, { threadId: ch.mainThreadId, name: "Open helper", idempotencyKey: key() })).agentId as string;
  assert.equal(w.audience.get(`fld_${a}`), "space");
  assert.equal(w.grants.some((g) => g.resource.type === "folder"), false);
});

test("an agent made in a private chat: its folder is closed, and the people of the chat hold it", async () => {
  const w = world();
  const threadId = (await h["chat.start"]!(w.hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const a = (await h["threads.agent.create"]!(w.hn.ctx, { threadId, name: "Chat helper", idempotencyKey: key() })).agentId as string;
  assert.equal(w.audience.get(`fld_${a}`), "added");
  assert.equal(folderOf(w.grants, DANA, a).length, 1, "the starter holds it");
  await h["threads.members.add"]!(w.hn.ctx, { threadId, personId: LEO });
  assert.equal(folderOf(w.grants, LEO, a).length, 1, "a person added to the chat gets it");
  await h["threads.members.remove"]!(w.hn.ctx, { threadId, personId: LEO });
  assert.deepEqual(folderOf(w.grants, LEO, a), [], "and loses it when taken out");
});

test("a newcomer to the invite-only channel gets the folder of the agents its threads made", async () => {
  const w = world();
  const { ch, a } = await inviteThread(w);
  await h["channels.members.add"]!(w.hn.ctx, { channelId: ch.channelId, personIds: [MIA] });
  assert.equal(folderOf(w.grants, MIA, a).length, 1, "Mia, added to the channel, reads the folder");
  assert.equal(agentOf(w.grants, MIA, a).length, 1, "and sees the agent");
});

test("the channel made public opens the folder to the Space; made invite-only again it closes, and its people hold it again", async () => {
  const w = world();
  const { ch, a } = await inviteThread(w);
  await h["channels.update"]!(w.hn.ctx, { channelId: ch.channelId, visibility: "public" });
  assert.equal(w.audience.get(`fld_${a}`), "space", "open with the channel");
  assert.equal(w.grants.some((g) => g.resource.id === a && g.subject.kind === "group" && g.subject.id === "space"), true, "the whole Space sees the agent, as for an agent an open channel made");
  w.grants.splice(0, w.grants.length, ...w.grants.filter((g) => g.resource.type !== "folder"));   // as if its people's folder grants were gone
  await h["channels.update"]!(w.hn.ctx, { channelId: ch.channelId, visibility: "invite" });
  assert.equal(w.audience.get(`fld_${a}`), "added", "closed with the channel");
  assert.equal(w.grants.some((g) => g.resource.id === a && g.subject.kind === "group"), false, "the Space no longer sees the agent");
  for (const who of [DANA, LEO]) assert.equal(folderOf(w.grants, who, a).length, 1, `${who} holds the folder again`);
});

test("an agent whose folder cannot be closed is not made", async () => {
  const w = world({ audienceFails: true });
  const ch = (await h["channels.create"]!(w.hn.ctx, { name: "legal", visibility: "invite", idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  await assert.rejects(() => h["threads.agent.create"]!(w.hn.ctx, { threadId: ch.mainThreadId, name: "Leaky", idempotencyKey: key() }));
  assert.equal(w.deleted.length, 1, "the agent made for it is put in Trash");
});

test("the start sweep brings an agent made before folders followed their chats in line", async () => {
  const w = world();
  const { a } = await inviteThread(w);
  w.audience.delete(`fld_${a}`);
  w.grants.splice(0, w.grants.length, ...w.grants.filter((g) => g.resource.type !== "folder"));
  await (periodic as unknown as Record<string, { run: (ctx: Harness["ctx"]) => Promise<void> }>)["chat.agent_homes"]!.run(w.hn.ctx);
  assert.equal(w.audience.get(`fld_${a}`), "added");
  for (const who of [DANA, LEO]) assert.equal(folderOf(w.grants, who, a).length, 1, `${who} holds the folder`);
});

test("added to an open channel as well, the agent keeps one folder, as private as its home chat: the open channel gives no one the folder", async () => {
  const w = world();
  const { a } = await inviteThread(w);
  const open = (await h["channels.create"]!(w.hn.ctx, { name: "open", visibility: "public", idempotencyKey: key() })).channel as { channelId: string; mainThreadId: string };
  await h["threads.add_agent"]!(w.hn.ctx, { threadId: open.mainThreadId, agentId: a }).catch(() => undefined);
  await h["channels.agents.add"]!(w.hn.ctx, { channelId: open.channelId, agentId: a }).catch(() => undefined);
  assert.equal(w.audience.get(`fld_${a}`), "added", "still closed");
  assert.equal(w.grants.some((g) => g.resource.id === `fld_${a}` && g.subject.kind === "group"), false, "no group holds the folder");
  await (periodic as unknown as Record<string, { run: (ctx: Harness["ctx"]) => Promise<void> }>)["chat.agent_homes"]!.run(w.hn.ctx);
  assert.equal(w.audience.get(`fld_${a}`), "added", "the sweep keeps it closed: only its home chat counts");
});

test("the start sweep run twice, or run after one stopped half way, ends in the same place", async () => {
  const w = world();
  const { a } = await inviteThread(w);
  const run = (periodic as unknown as Record<string, { run: (ctx: Harness["ctx"]) => Promise<void> }>)["chat.agent_homes"]!.run;
  await run(w.hn.ctx);
  const once = JSON.stringify([...w.grants].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
  await run(w.hn.ctx);
  assert.equal(JSON.stringify([...w.grants].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))), once, "twice: the same grants");
  // stopped half way: Leo's folder grant written, the cut not yet made
  w.audience.set(`fld_${a}`, "space");
  await run(w.hn.ctx);
  assert.equal(w.audience.get(`fld_${a}`), "added");
  assert.equal(JSON.stringify([...w.grants].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))), once, "and after a stop: the same grants");
});

test("a Space-wide agent added to an invite-only channel is not touched: its folder keeps the Space, and the channel gives no one its folder", async () => {
  const w = world();
  const { ch } = await inviteThread(w);
  await h["channels.agents.add"]!(w.hn.ctx, { channelId: ch.channelId, agentId: INTAKE }).catch(() => undefined);
  await (periodic as unknown as Record<string, { run: (ctx: Harness["ctx"]) => Promise<void> }>)["chat.agent_homes"]!.run(w.hn.ctx);
  assert.equal(w.audience.has(`fld_${INTAKE}`), false, "no audience is set on a Space agent's folder");
  assert.equal(w.grants.some((g) => g.resource.id === `fld_${INTAKE}`), false, "and no one is given it");
});
