// Threads notify the people in them (audit Threads 1, 3, 8), on a booted Team server with two members who joined with real key bundles. Ana writes in #intake; Ben replies under her
// message. Ana's live socket tells her something changed, and her banners, read again through the same remote hooks and the same arrival rule the shell uses, raise "ben replied in #intake"
// with Reply. Ben @mentions her: a mention notice, not a second reply notice. The line under her message counts the replies. She mutes the thread: Ben's next reply files nothing for her
// and the Threads row stops counting it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";
import { createRemoteScreenHooks } from "../apps/app/src/shell/session/remote-hooks.ts";
import type { RemoteHooks } from "../apps/app/src/shell/session/remote-hooks.ts";
import { BANNER_QUERY, arrivals } from "../apps/app/src/shell/notifications/model.ts";
import type { Notification } from "../apps/app/src/shell/notifications/model.ts";
import { replySummaries, replyWords } from "../apps/app/src/places/chats/conversation/replies.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Listed = { notifications: Notification[] };
interface Member { personId: string; token: string; hooks: RemoteHooks; changed: number; close(): void }

/** A member as the app holds them: remote hooks over their own session, re-read on each `changed` tick of their own live socket, with the banner read watched as the shell watches it. */
async function signedIn(d: Daemon, who: { personId: string; token: string }): Promise<Member> {
  const hooks = createRemoteScreenHooks({ screens: new Map(), read: async (cap, input) => { const r = await api(d, who.token, cap, input); if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.data)}`); return r.data; } });
  const m: Member = { ...who, hooks, changed: 0, close: () => undefined };
  const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/sync/v1/ws`, { headers: { authorization: `Bearer ${who.token}` } } as never);
  ws.addEventListener("message", (e) => {
    let f: { t?: string } = {};
    try { f = JSON.parse(String(e.data)) as { t?: string }; } catch { return; }
    if (f.t === "changed") { m.changed += 1; hooks.invalidate(); }
  });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("the live socket did not open"))); });
  ws.send(JSON.stringify({ t: "hello", hello: { deviceId: `dev_${who.personId}`, deviceClass: "web", appVersion: "1.2.3", registryHash: "unknown", cursor: 0, epoch: 0, replica: { entities: {} } } }));
  const keep = [hooks.capQuery("notifications.list", BANNER_QUERY).subscribe(() => undefined), hooks.capQuery("chat.recent", { filter: "all" }).subscribe(() => undefined)];
  m.close = () => { for (const off of keep) off(); hooks.close(); ws.close(); };
  return m;
}

const banners = (m: Member): Notification[] | null => { const s = m.hooks.capQuery<Listed>("notifications.list", BANNER_QUERY).getSnapshot(); return s.status === "ready" ? s.data.notifications : null; };
const threadsUnread = (m: Member): number | null => { const s = m.hooks.capQuery<{ threadsUnread?: number }>("chat.recent", { filter: "all" }).getSnapshot(); return s.status === "ready" ? s.data.threadsUnread ?? 0 : null; };

test("Team server: a reply notifies the person who follows the thread, a mention the person named, the reply count shows, and a muted thread neither notifies nor counts", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  const members: Member[] = [];
  const pump = async (): Promise<void> => { await (d as unknown as { hooks?: { pump?: () => Promise<void> } }).hooks?.pump?.(); };
  try {
    const anaJoin = await join(d, "ana");
    const benJoin = await join(d, "ben");
    const ana = await signedIn(d, anaJoin);
    const ben = await signedIn(d, benJoin);
    members.push(ana, ben);
    // the server's clock may be outside Ana's working hours, where a reply waits as a dot: she works around the clock here
    await ok(d, ana.token, "notifications.rules.set", { workingHours: null });
    // what the shell's banners already know when it opens: nothing is raised for it
    let known = arrivals(null, await waitFor(async () => banners(ana), 10_000)).known;

    const ch = (await ok(d, d.token, "channels.create", { name: "intake", visibility: "public", memberIds: [ana.personId, ben.personId], agentIds: [] })).channel as { mainThreadId: string };
    const said = (await ok(d, ana.token, "chat.post", { threadId: ch.mainThreadId, body: "Who takes the Rivera intake?" })).message.messageId as string;
    const thread = (await ok(d, ben.token, "chat.thread", { threadId: ch.mainThreadId, messageId: said })).thread.threadId as string;

    // Ben replies: Ana wrote the message, so the reply reaches her as a banner with Reply, through her own live socket
    const before = ana.changed;
    await ok(d, ben.token, "chat.post", { threadId: thread, body: "I can take it.\nCalling at 3" });
    const raised = await waitFor(async () => { await pump(); const got = arrivals(known, banners(ana) ?? []); return got.raise.length > 0 ? got : null; }, 15_000, () => `${hostLog(d)} ana sees ${JSON.stringify(banners(ana))}`);
    known = raised.known;
    const reply = raised.raise[0]!;
    assert.deepEqual([reply.kind, reply.title, reply.body, reply.subject, reply.actions], ["reply.thread", "ben replied in #intake", "I can take it.", { type: "thread", id: thread }, [{ label: "Reply", cap: "chat.post" }]]);
    assert.ok(ana.changed > before, "it came through Ana's own live socket");
    assert.equal((await ok(d, ben.token, "notifications.list", { unseenOnly: true })).notifications.length, 0, "Ben hears nothing about his own reply");

    // Ben mentions Ana: she hears the mention, not the reply as well
    await ok(d, ben.token, "chat.post", { threadId: thread, body: "@ana can you send me the file?", mentions: [{ kind: "person", id: ana.personId }] });
    const mention = await waitFor(async () => { await pump(); const got = arrivals(known, banners(ana) ?? []); return got.raise.length > 0 ? got : null; }, 15_000);
    known = mention.known;
    assert.deepEqual(mention.raise.map((n) => [n.kind, n.title]), [["mention", "ben mentioned you in #intake"]]);
    assert.equal((banners(ana) ?? []).find((n) => n.kind === "reply.thread")!.count, 1, "the mention did not count as a second reply");

    // the line under Ana's message: two replies, from Ben, both new to her
    const under = (await ok(d, ana.token, "threads.list", { parentThreadId: ch.mainThreadId, kind: ["thread"] })).threads;
    const line = replySummaries(under).get(said)!;
    assert.deepEqual([line.count, line.unread, line.people.map((p) => p.id)], [2, 2, [ben.personId]]);
    assert.equal(replyWords(line, { now: Date.now(), offsetMin: 0 }).count, "2 replies");
    assert.equal(await waitFor(async () => { const n = threadsUnread(ana); return n === 2 ? n : null; }, 10_000), 2, "the Threads row counts both");

    // Ana mutes the thread: Ben's next reply files nothing for her, and the Threads row stops counting it
    assert.deepEqual(await ok(d, ana.token, "threads.follow", { threadId: thread, mode: "mute" }), { mode: "mute" });
    ana.hooks.invalidate();
    assert.equal(await waitFor(async () => { const n = threadsUnread(ana); return n === 0 ? 0 : null; }, 10_000), 0, "a muted thread does not count");
    await ok(d, ben.token, "chat.post", { threadId: thread, body: "Done, it is in the file." });
    await pump();
    await new Promise((r) => setTimeout(r, 600));
    await pump();
    ana.hooks.invalidate();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(arrivals(known, banners(ana) ?? []).raise, [], "no banner from a muted thread");
    const all = (await ok(d, ana.token, "notifications.list", {})).notifications as Notification[];
    assert.equal(all.filter((n) => n.kind === "reply.thread").reduce((s, n) => s + n.count, 0), 1, "the muted reply filed nothing");
    assert.equal(threadsUnread(ana), 0);
    const row = (await ok(d, ana.token, "threads.list", { kind: ["thread"], mine: true, order: "latest", exceptScope: ["task"] })).threads.find((t: { threadId: string }) => t.threadId === thread);
    assert.deepEqual([row.muted, row.unread, row.replyCount], [true, 0, 3], "her Threads page shows it muted, with nothing new");
  } finally {
    for (const m of members) m.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
