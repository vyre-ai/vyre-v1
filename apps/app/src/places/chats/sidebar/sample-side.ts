// The sample Space as chats.sidebar answers it: the same rows the prototype shows, sectioned by the shared rule (lib/sidebar.ts), so a picture or a test draws the product's real answer shape without a server.
import { sectionsOf } from "../../../../../../lib/sidebar.ts";
import type { Item } from "../../../../../../lib/sidebar.ts";
import { allRows, itemsOf } from "./side-data.ts";
import type { SideOut, SideRow } from "./side-data.ts";
import type { SampleSpace, SampleThread } from "./sample.ts";

export function sampleSideOut(
  space: SampleSpace,
  threads: readonly SampleThread[],
  pinned: ReadonlySet<string> = new Set(),
  filterId = "all",
): SideOut {
  const rows: SideRow[] = [];
  for (const t of threads) {
    if (t.deleted || t.left) continue;
    const key = `c:${t.threadId}`;
    rows.push({
      key,
      kind: "chat",
      title: t.title,
      faceIds: t.agents,
      unread: t.unread + (t.repliesUnread ?? 0),
      mentions: 0,
      failed: false,
      working: t.working,
      muted: false,
      pinned: t.starred || pinned.has(key) ? 0 : null,
      lastAt: t.lastAt,
      threadId: t.threadId,
      ...(t.archived ? { archived: true } : {}),
    });
  }
  for (const c of space.channels)
    if (c.joined !== false)
      rows.push({
        key: `ch:${c.channelId}`,
        kind: c.project ? "project" : "channel",
        title: c.name,
        faceIds: [],
        unread: c.unread,
        mentions: 0,
        failed: false,
        working: false,
        muted: false,
        pinned: null,
        lastAt: 0,
        threadId: `th_${c.channelId}`,
        ...(c.visibility === "invite" ? { private: true } : {}),
      });
  for (const p of space.people ?? [])
    rows.push({
      key: `p:${p.id}`,
      kind: "person",
      title: p.name,
      faceIds: [p.id],
      unread: 0,
      mentions: 0,
      failed: false,
      working: false,
      muted: false,
      pinned: null,
      lastAt: 0,
      personId: p.id,
    });
  for (const a of [{ agentId: space.assistant.agentId, name: space.assistant.name, working: false }, ...space.agents])
    rows.push({
      key: `f:${a.agentId}`,
      kind: "agent",
      title: a.name,
      faceIds: [a.agentId],
      unread: 0,
      mentions: 0,
      failed: false,
      working: a.working === true,
      muted: false,
      pinned: null,
      lastAt: 0,
      agentId: a.agentId,
    });
  const draft: SideOut = {
    needs: {
      total: space.needsTotal,
      items: space.needs.map((n) => ({
        taskId: n.taskId,
        title: n.title,
        verb: n.kind === "approve" ? "Allow" : n.kind === "unblock" ? "Blocked" : "Review",
        askerId: n.by,
      })),
    },
    goals: { total: 0, rows: [] },
    pinned: { total: 0, rows: [] },
    chats: { total: 0, rows: [] },
    channels: { total: 0, rows: [] },
    team: { total: 0, rows: [] },
    rail: 0,
  };
  const { items, refs } = itemsOf({ ...draft, team: { total: rows.length, rows } }, space.assistant.agentId);
  const pins = rows.filter((r) => r.pinned !== null).map((r) => r.key);
  const sec = sectionsOf(items as Item[], pins, filterId as never);
  for (const k of ["goals", "pinned", "chats", "channels", "team"] as const)
    draft[k] = { total: sec[k].length, rows: sec[k].map((x) => refs.get(x.key)!).filter(Boolean) };
  void allRows;
  return draft;
}
