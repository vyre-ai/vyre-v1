// Chat finish (P-L2_26): the limits the four handler groups of P-L2_24 reported, each fixed by wrapping the group's own function.
//   chat.recent           real unread counts (the read cursor of threads.mark_read), the unread filter and nextUnread.
//   chat.composer.suggest the / table: the commands chat itself runs.
//   chat.open_tab         respects the person's tab setting (chat.agent_tabs) and answers no_device when none of their devices is online.
//   question, plan, helper and handoff messages in a thread that is already sealed: refused, because the server writes them in plain text and a sealed thread takes only envelopes of its own key.
// index.ts spreads g26Handlers after the groups, so these replace the group's entries of the same name.
import { CHAT_COMMANDS } from "../../../lib/chat-commands.ts";
import { askerOf, ensure, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { composerSuggest, openTab, recent } from "./g24c.ts";
import { unreadOf } from "./g24a.ts";
import { handoff, helperStart, planPropose, questionAsk } from "./g24d.ts";
import { isDirect, rootOf } from "./post.ts";
import { ensurePrivate, sealedBy } from "./private.ts";

type Row = Record<string, unknown>;

// ---- recent -----------------------------------------------------------------------------------------------------------------------------------------

type Section = "starred" | "today" | "yesterday" | "earlier" | "archived";
const SECTIONS: readonly Section[] = ["starred", "today", "yesterday", "earlier", "archived"];

export async function recentWithUnread(ctx: ChatCtx, input: { filter?: "all" | "unread" | "people" | "agents" }) {
  const asker = askerOf(ctx);
  const filter = input.filter ?? "all";
  // The group's function knows the listing rules; the unread filter is applied here on the counts it cannot see.
  const base = (await recent(ctx, { filter: filter === "unread" ? "all" : filter })) as Record<Section, Row[]> & { nextUnread: string | null };
  const out: Record<Section, Row[]> = { starred: [], today: [], yesterday: [], earlier: [], archived: [] };
  let nextUnread: string | null = null;
  for (const s of SECTIONS) {
    for (const row of base[s] ?? []) {
      const unread = unreadOf(ctx, String(row["threadId"]), asker);
      if (filter === "unread" && unread === 0) continue;
      out[s].push({ ...row, unread });
      // an archived chat is quiet: its unread never picks the "next unread" chat
      if (nextUnread === null && unread > 0 && s !== "archived") nextUnread = String(row["threadId"]);
    }
  }
  return { ...out, nextUnread };
}

// ---- composer ---------------------------------------------------------------------------------------------------------------------------------------

/** The commands the composer offers: the one list in lib/chat-commands.ts, which the app runs. Skills and plugin commands belong to other modules and are added by the app. */
const COMMANDS: ReadonlyArray<{ id: string; title: string; detail: string }> = CHAT_COMMANDS.map((c) => ({ id: c.id, title: `/${c.id}`, detail: c.detail }));

export async function composerWithCommands(ctx: ChatCtx, input: { symbol: "@" | "#" | "/"; q: string; threadId?: string }) {
  if (input.symbol !== "/") return composerSuggest(ctx, input);
  const q = input.q.trim().replace(/^[@#/]+/, "").toLowerCase();
  const items = COMMANDS.filter((c) => q === "" || c.id.includes(q)).map((c) => ({ group: "Commands", kind: "command", id: c.id, title: c.title, detail: c.detail }));
  return { items };
}

// ---- open_tab ---------------------------------------------------------------------------------------------------------------------------------------

/** A device counts as online when the server heard from it in the last two minutes (the same rule engine placement uses). */
const ONLINE_MS = 120_000;

export async function openTabChecked(ctx: ChatCtx, input: { threadId: string; targetType: string; targetId: string; title?: string }) {
  if (ctx.principal.kind === "agent") {
    // The person's tab setting. A setting that cannot be read is the default, which is on.
    try {
      const s = (await ctx.call("settings.get", { key: "chat.agent_tabs" })) as { row?: { value?: unknown } } | null;
      if (s?.row?.value === false) return { opened: false, reason: "disabled_by_person" as const };
    } catch { /* the default is on */ }
    // A tab opens on a screen: at least one of the person's devices must be there.
    try {
      const d = (await ctx.call("devices.mine", {})) as { devices?: Array<{ lastSeenAt?: number; revokedAt?: number }> } | null;
      if (d?.devices !== undefined && !d.devices.some((x) => x.revokedAt === undefined && x.lastSeenAt !== undefined && ctx.now() - x.lastSeenAt <= ONLINE_MS)) {
        return { opened: false, reason: "no_device" as const };
      }
    } catch { /* devices cannot be read: do not turn a tab away on a guess */ }
  }
  return openTab(ctx, input);
}

// ---- the sealed-thread guard for messages the server writes ---------------------------------------------------------------------------------------------

/** True when the thread (or the chat it hangs from) is a private chat that has been sealed by its owner. */
export function sealedThread(ctx: ChatCtx, threadId: string): boolean {
  ensure(ctx.db);
  ensurePrivate(ctx.db);
  const t = threadBy(ctx.db, threadId);
  if (!t) return false;
  const root = rootOf(ctx, t);
  return !isDirect(ctx, root) && sealedBy(ctx.db, root.id) !== null;
}

/** The server writes these messages in plain text, so in a sealed thread they are refused (a client or a runtime that holds the key posts them sealed through chat.post). */
export function refuseWhenSealed<I extends { threadId: string }, O>(inner: (ctx: ChatCtx, input: I) => Promise<O>): (ctx: ChatCtx, input: I) => Promise<O> {
  return async (ctx, input) => {
    if (sealedThread(ctx, input.threadId)) {
      raise(ctx, "validation.bad_input", "This chat is sealed under your key, so the server cannot write this message in it. Post it from a device that holds the key.", { reason: "sealed_thread" });
    }
    return inner(ctx, input);
  };
}

export const g26Handlers = {
  "chat.recent": recentWithUnread,
  "chat.composer.suggest": composerWithCommands,
  "chat.open_tab": openTabChecked,
  "chat.question.ask": refuseWhenSealed(questionAsk),
  "chat.plan.propose": refuseWhenSealed(planPropose),
  "chat.helper.start": refuseWhenSealed(helperStart),
  "chat.handoff": refuseWhenSealed(handoff),
};
