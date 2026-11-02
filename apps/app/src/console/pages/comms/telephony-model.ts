// Telephony in the Console: the words and rules of the guided connect and the assign step, as plain functions so they are tested without drawing anything.
export const TWILIO_ACCOUNT_HANDLE = "#Twilio_Account";
export const TWILIO_AUTH_HANDLE = "#Twilio_Auth";
export const TWILIO_CONSOLE = "https://console.twilio.com";

/** What is wrong with what was typed, before anything leaves the page. Empty when it can go. */
export function credentialProblem(sid: string, token: string): string {
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid.trim())) return "That is not an Account SID. It starts with AC and has 34 characters.";
  if (token.trim() === "") return "Paste the Auth Token.";
  return "";
}

export interface ConnectOut { connected: boolean; detail?: string | undefined; imported: number; total: number; notSetUp: number }
/** The one line after Connect. A refusal is the server's own plain words. */
export function connectLine(o: ConnectOut): string {
  if (!o.connected) return o.detail ?? "Twilio did not answer. Try again in a minute.";
  const brought = o.total === 1 ? "1 number brought in." : `${o.total} numbers brought in.`;
  return o.notSetUp > 0 ? `${brought} ${o.notSetUp} could not be set up for calls and texts. Check them in Twilio.` : brought;
}

export interface Assignee { kind: "person" | "agent"; id: string }
/** Numbers that need an owner, and the rest. */
export function splitNumbers<T extends { assignees: readonly Assignee[] }>(rows: readonly T[]): { open: T[]; held: T[] } {
  return { open: rows.filter((r) => r.assignees.length === 0), held: rows.filter((r) => r.assignees.length > 0) };
}

/** The label on the assign control: one full name, or first names. */
export function whoLabel(assignees: readonly Assignee[], nameOf: (a: Assignee) => string): string {
  if (assignees.length === 0) return "Assign";
  if (assignees.length === 1) return nameOf(assignees[0]!);
  return assignees.map((a) => nameOf(a).split(" ")[0]).join(", ");
}

/** Add someone to a number, or take them off. */
export function toggled(assignees: readonly Assignee[], who: Assignee): Assignee[] {
  return assignees.some((a) => a.id === who.id) ? assignees.filter((a) => a.id !== who.id) : [...assignees, who];
}

export const OWNER_LINE = "Only admins can see these until someone is assigned.";
export const PRIVATE_LINE = "Only the people on a number see its texts and calls in their Inbox, and only they can text or call from it. A message with a known contact also joins that contact's Conversation, for everyone who can open the contact.";
