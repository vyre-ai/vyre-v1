// What a person sees of Google Workspace and Microsoft 365 in Settings: what is connected for them through their firm, service by service, and what to do when it is not. The firm connects
// the suite once (Console, Integrations); a person never signs in to it themselves. Pure, so the rules are tested without drawing.

export interface MailboxLite { id: string; address: string; provider: string; state: string }
export interface CalendarLite { id: string; title: string; provider: string; state: string }

export interface SuiteRow { key: string; service: "Mail" | "Calendar"; detail: string; state: string }
export interface SuiteSection { key: "google" | "microsoft"; title: string; rows: SuiteRow[] }

const TITLE = { google: "Google Workspace", microsoft: "Microsoft 365" } as const;
const MAIL_STATE: Readonly<Record<string, string>> = { pending: "Connecting", syncing: "Syncing", paused: "Paused", error: "Needs attention", disconnected: "Disconnected" };
const CAL_STATE: Readonly<Record<string, string>> = { syncing: "Syncing", paused: "Paused", error: "Needs attention" };

/** One section per suite the firm connected for this person, with a row for each of their mailboxes and calendars that comes through it. */
export function suiteSections(boxes: readonly MailboxLite[], calendars: readonly CalendarLite[]): SuiteSection[] {
  const out: SuiteSection[] = [];
  for (const key of ["google", "microsoft"] as const) {
    const rows: SuiteRow[] = [
      ...boxes.filter((b) => b.provider === key).map((b): SuiteRow => ({ key: `mail.${b.id}`, service: "Mail", detail: b.address, state: MAIL_STATE[b.state] ?? b.state })),
      ...calendars.filter((c) => c.provider === key).map((c): SuiteRow => ({ key: `cal.${c.id}`, service: "Calendar", detail: c.title, state: CAL_STATE[c.state] ?? c.state })),
    ];
    if (rows.length > 0) out.push({ key, title: TITLE[key], rows });
  }
  return out;
}

export const NOT_CONNECTED = "Your firm has not connected Google Workspace or Microsoft 365 for you yet. Nothing is wrong. Ask your admin to open Console, Integrations and set up the one your firm uses.";
export const THROUGH_FIRM = "Connected through your firm";

/** The line under a connected suite. */
export function throughFirm(section: SuiteSection): string {
  return section.rows.some((r) => r.state === "Needs attention") ? `${THROUGH_FIRM}. Something needs attention: ask your admin to check the connection in Console, Integrations.` : THROUGH_FIRM;
}
