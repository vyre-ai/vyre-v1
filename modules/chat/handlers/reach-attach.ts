// A card in a message names a thing; whether the reader may open it is answered when the message is served, so the first draw is already right (owner, 4 Nov: never send anyone to a place they
// cannot open, and never let a link flip after it draws). The level comes from access.reach for the reader, one call for every card on the page, and rides in the card's data as `reach`:
// "none", "view", "use", "edit" or "manage". Nothing about the thing is told with it. A call that cannot be made leaves the card as it was, and the app asks for itself.
import type { ChatCtx } from "../projections.ts";

const RESOURCE_OF: Readonly<Record<string, string>> = {
  thread: "thread", chat: "thread", channel: "channel", file: "file", doc: "file", document: "file", folder: "folder", record: "record", contact: "record", task: "task",
  run: "run", automation: "automation", project: "project", agent: "agent", computer: "computer", vault_item: "vault_item",
};

interface Block { type?: string; data?: unknown; [k: string]: unknown }

/** Copies of the messages with the reader's level attached to each link card that names a thing. The stored blocks are never touched. */
export async function attachReach<M extends { blocks?: unknown }>(ctx: ChatCtx, messages: readonly M[]): Promise<M[]> {
  const want = new Map<string, { type: string; id: string }>();
  for (const m of messages) {
    for (const b of (Array.isArray(m.blocks) ? m.blocks : []) as Block[]) {
      const target = b.type === "link_card" ? (b.data as { target?: { type?: unknown; id?: unknown } } | undefined)?.target : undefined;
      const type = typeof target?.type === "string" ? RESOURCE_OF[target.type] : undefined;
      if (type !== undefined && typeof target?.id === "string") want.set(`${type}:${target.id}`, { type, id: target.id });
    }
  }
  if (want.size === 0 || !ctx.call) return [...messages];
  const levels = new Map<string, string>();
  try {
    const out = (await ctx.call("access.reach", { items: [...want.values()].slice(0, 200) })) as { items?: Array<{ type: string; id: string; level: string }> };
    for (const r of out.items ?? []) levels.set(`${r.type}:${r.id}`, r.level);
  } catch { return [...messages]; }
  return messages.map((m) => {
    if (!Array.isArray(m.blocks)) return m;
    const blocks = (m.blocks as Block[]).map((b) => {
      const d = b.data as { target?: { type?: unknown; id?: unknown } } | undefined;
      const type = b.type === "link_card" && typeof d?.target?.type === "string" ? RESOURCE_OF[d.target.type] : undefined;
      const level = type !== undefined && typeof d?.target?.id === "string" ? levels.get(`${type}:${d.target.id}`) : undefined;
      return level === undefined ? b : { ...b, data: { ...(d as object), reach: level } };
    });
    return { ...m, blocks };
  });
}
