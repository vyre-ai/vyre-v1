// A member's Outlook calendar in Calendar. Delegation puts each included member's default calendar in Calendar (owned by them, read as their account) and the mailbox pass keeps it
// current by asking Calendar to sync it: Calendar owns the events, the sync token and the merge with Meetings; this file only connects and nudges. A failure here never fails the
// setup or the mailbox pass.
import { codeOf, first, strOrNull } from "../projections.ts";
import type { MsCtx } from "../projections.ts";

/**
 * Connect (or, with connected false, remove) the member's calendar and remember which Calendar calendar it is. Connecting takes an admin (calendar.connect_provider needs
 * connectors.manage), so it happens when delegation is set up and when a member is included again, never on a mailbox pass.
 */
export async function connectCalendar(ctx: MsCtx, a: { connectionId: string; userId: string; email: string; connected?: boolean }): Promise<string | undefined> {
  try {
    const out = (await ctx.call("calendar.connect_provider", {
      provider: "microsoft", ownerId: a.userId, account: a.email, connectionId: a.connectionId, remoteId: "default", ...(a.connected === false ? { connected: false } : {}),
    })) as { calendarId?: unknown };
    const calendarId = typeof out.calendarId === "string" ? out.calendarId : undefined;
    ctx.db.run(`DELETE FROM microsoft_calendar WHERE email = ?`, a.email);
    if (a.connected !== false && calendarId) ctx.db.run(`INSERT INTO microsoft_calendar (email, "calendarId") VALUES (?, ?)`, a.email, calendarId);
    return calendarId;
  } catch (e) {
    ctx.log.warn("microsoft calendar connect failed", { mailbox: a.email, code: codeOf(e) });
    return undefined;
  }
}

/** Ask Calendar to sync this member's calendar now. A member with no calendar connected (they came after setup) has nothing to sync until an admin connects again. */
export async function syncCalendar(ctx: MsCtx, a: { connectionId: string; email: string }): Promise<void> {
  const calendarId = strOrNull(first(ctx.db.all(`SELECT "calendarId" FROM microsoft_calendar WHERE email = ?`, a.email)), "calendarId");
  if (!calendarId) return;
  try {
    await ctx.call("calendar.sync_now", { calendarId });
  } catch (e) {
    ctx.log.warn("microsoft calendar sync failed", { mailbox: a.email, code: codeOf(e) });
  }
}
