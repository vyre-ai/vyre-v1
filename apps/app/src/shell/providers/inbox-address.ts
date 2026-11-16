// The address of a row in the Inbox's sidebar: which inbox or list, and which view. Pure, and kept with the shell's Inbox data because the phone's startup code
// opens such a row (Open in New Tab) without loading the Inbox place.
export type View = "contact" | "thread" | "calls";
/** What the sidebar has selected. Mailbox and number are one inbox each; Starred and Following are lists over all inboxes. */
export type Scope =
  | { kind: "all" }
  | { kind: "mailbox"; id: string }
  | { kind: "number"; id: string }
  | { kind: "starred" }
  | { kind: "follow" };
/** Where a sidebar row leads: an inbox or list (scope and view) or one of the other main views. */
export interface InboxAddress {
  scope?: Scope;
  view?: View;
  main?: "calendar" | "meetings" | "replies";
}
/** The address of a sidebar row, so a tab can open on it (Open in New Tab). */
export function scopeArgs(a: InboxAddress): Record<string, string> {
  const s = a.scope;
  const at = s === undefined ? undefined : s.kind === "mailbox" || s.kind === "number" ? `${s.kind}:${s.id}` : s.kind;
  return { ...(at ? { scope: at } : {}), ...(a.view ? { view: a.view } : {}), ...(a.main ? { main: a.main } : {}) };
}
