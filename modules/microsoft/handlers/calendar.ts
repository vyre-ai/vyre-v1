// A member's Outlook calendar in Calendar. Delegation puts each included member's default calendar in Calendar (owned by them, read as their account) and the mailbox pass keeps it
// current by asking Calendar to sync it: Calendar owns the events, the sync token and the merge with Meetings; this file only connects and nudges. A failure here never fails the
// setup or the mailbox pass.
import { codeOf, first, strOrNull } from "../projections.ts";
import type { MsCtx } from "../projections.ts";

/** Connect (or, with connected false, remove) the member's calendar; answers its id, or undefined when Calendar could not be asked. */
export async function connectCalendar(ctx: MsCtx, a: { connectionId: string; userId: string; email: string; connected?: boolean }): Promise<string | undefined> {
  try {
    const out = (await ctx.call("calendar.connect_provider", {
      provider: "microsoft", ownerId: a.userId, account: a.email, connectionId: a.connectionId, remoteId: "default", ...(a.connected === false ? { connected: false } : {}),
    })) as { calendarId?: unknown };
    return typeof out.calendarId === "string" ? out.calendarId : undefined;
  } catch (e) {
    ctx.log.warn("microsoft calendar connect failed", { mailbox: a.email, code: codeOf(e) });
    return undefined;
  }
}

/** Ask Calendar to sync this member's calendar now (it is connected first when it is not yet). */
export async function syncCalendar(ctx: MsCtx, a: { connectionId: string; email: string }): Promise<void> {
  const userId = strOrNull(first(ctx.db.all(`SELECT "userId" FROM microsoft_member WHERE email = ?`, a.email)), "userId");
  if (!userId) return;
  const calendarId = await connectCalendar(ctx, { connectionId: a.connectionId, userId, email: a.email });
  if (!calendarId) return;
  try {
    await ctx.call("calendar.sync_now", { calendarId });
  } catch (e) {
    ctx.log.warn("microsoft calendar sync failed", { mailbox: a.email, code: codeOf(e) });
  }
}
