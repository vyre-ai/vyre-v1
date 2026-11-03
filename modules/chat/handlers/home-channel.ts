// The Space's first channel (owner D22, 3 Nov): every Team Space has #vyre, and every new member is in it from day one.
//   channels.home        which channel that is: #vyre, or the #general an older Space already has (Console offers to rename it, never silently)
//   channels.home_join   system: put one person in it (the join step of members); makes #vyre first when the Space has neither
//   chat.home_channel    the periodic hook that makes #vyre in a Team Space that has no #vyre and no #general, with everyone already in the Space
// DECISION: #vyre is public, so anyone can find it in Browse; the people in the Space when it is made, and everyone who joins after, are members. Nobody is added to an existing #general.
import { isSystemCall } from "../../../lib/trust.ts";
import { addMember, channelByName, ensure, insertChannel, insertThread, isMember, mintId, raise } from "../projections.ts";
import type { ChannelRec, ChatCtx } from "../projections.ts";

export const HOME_CHANNEL = "vyre";
export const LEGACY_HOME = "general";

/** #vyre, else an older Space's #general, else none. */
export function homeChannel(ctx: Pick<ChatCtx, "db">): { channel: ChannelRec; legacy: boolean } | null {
  const vyre = channelByName(ctx.db, HOME_CHANNEL);
  if (vyre) return { channel: vyre, legacy: false };
  const general = channelByName(ctx.db, LEGACY_HOME);
  return general ? { channel: general, legacy: true } : null;
}

async function spaceOf(ctx: ChatCtx): Promise<{ kind?: string; name?: string; owner?: string } | null> {
  if (!ctx.call) return null;
  try { return ((await ctx.call("spaces.get", {})) as { space?: { kind?: string; name?: string; owner?: string } } | null)?.space ?? null; } catch { return null; }
}

async function peopleOf(ctx: ChatCtx): Promise<string[]> {
  if (!ctx.call) return [];
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    type Page = { principals?: { id: string; kind?: string; status?: string }[]; next?: string } | null;
    let page: Page = null;
    try { page = (await ctx.call("access.principals.list", { kind: "person", status: "active", limit: 500, ...(cursor ? { cursor } : {}) })) as Page; } catch { break; }
    for (const p of page?.principals ?? []) if (p.id.startsWith("usr_") && (p.status === undefined || p.status === "active")) out.push(p.id);
    if (!page?.next) break;
    cursor = page.next;
  }
  return out;
}

/** Make #vyre when a Team Space has no first channel. Answers the channel, or null in a Personal Space. Safe to run again: a second run finds the channel and does nothing. */
export async function ensureHome(ctx: ChatCtx): Promise<{ channel: ChannelRec; legacy: boolean; made: boolean } | null> {
  ensure(ctx.db);
  const have = homeChannel(ctx);
  if (have) return { ...have, made: false };
  const space = await spaceOf(ctx);
  if (!space || space.kind !== "team") return null;
  const now = ctx.now();
  const channelId = mintId("chn", now);
  const topic = `Everyone in ${space.name ?? "this Space"}`;
  const by = space.owner && space.owner.startsWith("usr_") ? space.owner : ctx.principal.id;
  const main = insertThread(ctx, { kind: "channel", title: HOME_CHANNEL, starter: by, channelId, listed: true });
  const people = await peopleOf(ctx);
  if (space.owner && space.owner.startsWith("usr_") && !people.includes(space.owner)) people.unshift(space.owner);
  for (const p of people) addMember(ctx, main.id, p, p === space.owner ? "owner" : "member");
  const channel = insertChannel(ctx, { id: channelId, mainThread: main.id, name: HOME_CHANNEL, topic, visibility: "public", createdBy: by });
  ctx.emit("channel.created", channel.id, { channelId: channel.id, name: HOME_CHANNEL, visibility: "public" });
  ctx.emit("thread.started", main.id, { threadId: main.id, kind: "channel", starter: by, channelId: channel.id });
  for (const p of people) ctx.emit("channel.member_added", channel.id, { channelId: channel.id, threadId: main.id, personId: p, by });
  return { channel, legacy: false, made: true };
}

/** Which channel is the Space's first one, so the invite sheet can tick it and Console can offer to rename #general. */
export async function channelsHome(ctx: ChatCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const h = homeChannel(ctx);
  if (!h) return { channel: null };
  return { channel: { channelId: h.channel.id, name: h.channel.name, mainThreadId: h.channel.mainThread, legacy: h.legacy } };
}

/** The join step: put one person in the first channel, making #vyre first when there is none. Only another capability (members' join) or the host calls it. */
export async function channelsHomeJoin(ctx: ChatCtx, input: { personId: string }) {
  if (!isSystemCall({ depth: ctx.depth ?? 0, principal: ctx.principal })) raise(ctx, "permission.role_lacks_permission", "This is the join step, not a direct call.");
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "Only a person joins a channel.");
  const h = await ensureHome(ctx);
  if (!h) return { channelId: null, added: false };
  const thread = h.channel.mainThread;
  if (isMember(ctx.db, thread, input.personId)) return { channelId: h.channel.id, added: false };
  addMember(ctx, thread, input.personId);
  ctx.emit("channel.member_added", h.channel.id, { channelId: h.channel.id, threadId: thread, personId: input.personId, by: ctx.principal.id });
  return { channelId: h.channel.id, added: true };
}
