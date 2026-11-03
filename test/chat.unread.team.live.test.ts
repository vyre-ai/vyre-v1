// Unread on a Team server (owner report, rc.14: "unread messages dont get a notification dot next to people on Chats"). A booted server-role daemon, two members who joined with real key
// bundles. Ana writes Ben a direct message; Ben's own live socket is told something changed, and his Chats data, read again through the same remote hooks the app uses, shows the unread on
// Ana's People row and on the chat in Recent, and lights the rail's Chats dot, with no refresh and no polling. Ben opens the chat (catch-up, then the read cursor, as the open chat does) and
// all of it clears. Ana never sees her own message as unread. Mark as Unread brings Ben's dot back and Mark as Read takes it away; a channel message raises the channel's count.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";
import { createRemoteScreenHooks } from "../apps/app/src/shell/session/remote-hooks.ts";
import type { RemoteHooks } from "../apps/app/src/shell/session/remote-hooks.ts";
import { anyUnread, buildEntries, dmPerson, peopleWithUnread, personUnread } from "../apps/app/src/places/chats/sidebar/model.ts";
import type { RecentOut } from "../apps/app/src/places/chats/sidebar/model.ts";
import { kitById, railFor } from "../apps/app/src/shell/rail/kits.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Channels = { channels: Array<{ channelId: string; mainThreadId: string; unread: number }> };
interface Member { personId: string; token: string; hooks: RemoteHooks; changed: number; close(): void }

/** A member's Chats data as the app holds it: the remote hooks over their own session, re-read on each `changed` tick of their own live socket (session.ts does the same). */
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
  // the sidebar's two reads and the rail's: watched for the whole test, as the app keeps them
  const keep = [hooks.capQuery("chat.recent", { filter: "all" }).subscribe(() => undefined), hooks.capQuery("channels.list", {}).subscribe(() => undefined)];
  m.close = () => { for (const off of keep) off(); hooks.close(); ws.close(); };
  return m;
}

const snap = <T,>(m: Member, cap: string, input: Record<string, unknown>): T | null => { const s = m.hooks.capQuery<T>(cap, input).getSnapshot(); return s.status === "ready" ? s.data : null; };
const recentOf = (m: Member): RecentOut | null => snap<RecentOut>(m, "chat.recent", { filter: "all" });
const channelsOf = (m: Member): Channels["channels"] => snap<Channels>(m, "channels.list", {})?.channels ?? [];
const dmRow = (r: RecentOut, threadId: string) => [...r.starred, ...r.today, ...r.yesterday, ...r.earlier].find((x) => x.threadId === threadId);
/** Ben's view, mapped exactly as the sidebar and the rail map it. */
function view(m: Member, other: { personId: string; name: string }, threadId: string) {
  const recent = recentOf(m);
  if (!recent) return null;
  const people = peopleWithUnread([{ id: other.personId, name: other.name }], personUnread(recent));
  const row = buildEntries({ faces: [], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set(), people }).find((e) => e.key === `p:${other.personId}`);
  const dot = railFor({ kit: kitById("northwind"), console: false, counts: {}, dots: { chats: anyUnread(recent, channelsOf(m)) }, active: "records" }).top.find((e) => e.place === "chats")?.dot === true;
  return { person: row && row.type === "person" ? row.unread : -1, recent: dmRow(recent, threadId)?.unread ?? -1, dot };
}

test("Team server: a direct message lights the person's row, Recent and the rail for the one it was sent to, live; opening it clears all three; a channel message raises the channel", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  const members: Member[] = [];
  try {
    const anaJoin = await join(d, "ana");
    const benJoin = await join(d, "ben");
    const ana = await signedIn(d, anaJoin);
    const ben = await signedIn(d, benJoin);
    members.push(ana, ben);
    await waitFor(async () => (recentOf(ben) && recentOf(ana) ? true : null), 10_000);

    // Ana writes to Ben
    const threadId = (await ok(d, ana.token, "chat.start", { kind: "chat", agentIds: [], personId: ben.personId })).thread.threadId as string;
    const before = ben.changed;
    await ok(d, ana.token, "chat.post", { threadId, body: "Ben, can you take the Rivera call?" });
    const lit = await waitFor(async () => { const v = view(ben, { personId: ana.personId, name: "ana" }, threadId); return v && v.person > 0 ? v : null; }, 10_000);
    assert.deepEqual(lit, { person: 1, recent: 1, dot: true }, "Ana's row, the chat in Recent and the rail's Chats dot");
    assert.ok(ben.changed > before, "it came through Ben's own live socket: nothing polled and nothing was refreshed by hand");
    assert.equal(dmPerson(dmRow(recentOf(ben)!, threadId)!), ana.personId, "the server names who the direct message is with");

    // Ana never sees her own message as unread
    const anaView = await waitFor(async () => { const r = recentOf(ana); return r && dmRow(r, threadId) ? view(ana, { personId: ben.personId, name: "ben" }, threadId) : null; }, 10_000);
    assert.deepEqual(anaView, { person: 0, recent: 0, dot: false });

    // Ben opens the chat: the catch-up is read first, then the read cursor moves (catch-up.tsx); the app re-reads after a write
    await ok(d, ben.token, "chat.catch_up", { threadId });
    await ok(d, ben.token, "threads.mark_read", { threadId });
    ben.hooks.invalidate();
    const cleared = await waitFor(async () => { const v = view(ben, { personId: ana.personId, name: "ana" }, threadId); return v && v.person === 0 ? v : null; }, 10_000);
    assert.deepEqual(cleared, { person: 0, recent: 0, dot: false }, "all three clear");

    // Mark as Unread from the row's menu brings the dot back; Mark as Read takes it away
    assert.deepEqual(await ok(d, ben.token, "threads.mark_read", { threadId, unread: true }), { unread: 1 });
    ben.hooks.invalidate();
    assert.deepEqual(await waitFor(async () => { const v = view(ben, { personId: ana.personId, name: "ana" }, threadId); return v && v.person === 1 ? v : null; }, 10_000), { person: 1, recent: 1, dot: true });
    assert.deepEqual(await ok(d, ben.token, "threads.mark_read", { threadId }), { unread: 0 });
    ben.hooks.invalidate();
    await waitFor(async () => { const v = view(ben, { personId: ana.personId, name: "ana" }, threadId); return v && v.person === 0 && !v.dot ? v : null; }, 10_000);

    // a channel message raises the channel's count for Ben, live, and the rail's dot with it; never for Ana, who wrote it
    const ch = (await ok(d, d.token, "channels.create", { name: "intake", visibility: "public", memberIds: [ana.personId, ben.personId], agentIds: [] })).channel as { channelId: string; mainThreadId: string };
    await ok(d, ana.token, "chat.post", { threadId: ch.mainThreadId, body: "New intake from the web form" });
    const count = await waitFor(async () => { const c = channelsOf(ben).find((x) => x.channelId === ch.channelId); return c && c.unread > 0 ? c.unread : null; }, 10_000);
    assert.equal(count, 1);
    assert.equal(view(ben, { personId: ana.personId, name: "ana" }, threadId)!.dot, true, "the rail's dot follows the channel too");
    await waitFor(async () => (channelsOf(ana).some((x) => x.channelId === ch.channelId) ? true : null), 10_000);
    assert.equal(channelsOf(ana).find((x) => x.channelId === ch.channelId)!.unread, 0, "Ana's own message is not new to her");
    await ok(d, ben.token, "threads.mark_read", { threadId: ch.mainThreadId });
    ben.hooks.invalidate();
    await waitFor(async () => (channelsOf(ben).find((x) => x.channelId === ch.channelId)?.unread === 0 && !view(ben, { personId: ana.personId, name: "ana" }, threadId)!.dot ? true : null), 10_000);
  } finally {
    for (const m of members) m.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
