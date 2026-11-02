// A member's Google calendar in Calendar. Delegation puts each included member's primary calendar in Calendar (owned by them, read as their account) and Calendar pulls its events on its own schedule
// (calendar.pull_provider, run by the server): Calendar owns the events, the sync token and the merge with Meetings; this file only connects. A failure here never fails the setup.
import { codeOf } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";

/**
 * Connect (or, with connected false, remove) the member's calendar and remember which Calendar calendar it is. Connecting takes an admin (calendar.connect_provider needs
 * connectors.manage), so it happens when delegation is set up and when a member is included again, never on a mailbox pass.
 */
export async function connectCalendar(ctx: GoogleCtx, a: { connectionId: string; userId: string; email: string; connected?: boolean }): Promise<string | undefined> {
  try {
    const out = (await ctx.call("calendar.connect_provider", {
      provider: "google", ownerId: a.userId, account: a.email, connectionId: a.connectionId, remoteId: "primary", ...(a.connected === false ? { connected: false } : {}),
    })) as { calendarId?: unknown };
    const calendarId = typeof out.calendarId === "string" ? out.calendarId : undefined;
    ctx.db.run(`DELETE FROM google_calendar WHERE email = ?`, a.email);
    if (a.connected !== false && calendarId) ctx.db.run(`INSERT INTO google_calendar (email, "calendarId") VALUES (?, ?)`, a.email, calendarId);
    return calendarId;
  } catch (e) {
    ctx.log.warn("google calendar connect failed", { mailbox: a.email, code: codeOf(e) });
    return undefined;
  }
}
