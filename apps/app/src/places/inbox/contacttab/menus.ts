// The contact tab's menus, as data, so a test can read them without a click.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { InboxChoice, MailThread } from "./model.ts";

/** Header actions: the pure part, so the menus can be tested without a click. */
export function followMenuEntries(followed: boolean, alertOnReplies: boolean, on: { follow(follow: boolean): void; alert(alert: boolean): void }): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: followed ? "Unfollow" : "Follow", onSelect: () => on.follow(!followed) }];
  if (followed) entries.push({ label: "Alert me on replies", checked: alertOnReplies, onSelect: () => on.alert(!alertOnReplies) });
  return entries;
}

export function fromMenuEntries(choices: readonly InboxChoice[], current: string | null, cameIn: readonly string[], pick: (id: string) => void, connect?: { label: string; run(): void }): MenuEntry[] {
  // nothing can send yet: the one way forward is to connect a mailbox or number
  if (choices.length === 0 && connect) return [{ head: "Send from" }, { label: connect.label, onSelect: connect.run }];
  return [{ head: "Send from" }, ...choices.map((c) => ({ label: cameIn.includes(c.id) ? `${c.label} (this conversation)` : c.label, checked: c.id === current, onSelect: () => pick(c.id) }))];
}

/** The template button: each template inserts its text at the foot of the draft. */
export function templateEntries(templates: readonly { t: string; body: string }[], insert: (body: string) => void, design?: () => void): MenuEntry[] {
  const rows = templates;
  // the last row opens the email builder, where a template is made or changed
  const build: MenuEntry[] = design ? [{ separator: true }, { label: "Design a template…", onSelect: design }] : [];
  if (rows.length === 0) return [{ label: "No templates yet" }, ...build];
  return [{ head: "Templates" }, ...rows.map((r) => ({ label: r.t, onSelect: () => insert(r.body) })), ...build];
}

/** The quick-action button: the things a person does next with this contact. */
export function quickEntries(hasRecord: boolean, on: { dial(): void; openRecord(): void; attach(): void }): MenuEntry[] {
  return [
    { label: "Call", onSelect: on.dial },
    { label: "Attach from Files", onSelect: on.attach },
    ...(hasRecord ? [{ label: "Open the record", onSelect: on.openRecord }] : []),
  ];
}

/** Replying in: every thread with this contact, newest first, and New Email, which starts a separate thread. */
export function threadMenuEntries(threads: readonly MailThread[], current: string | null, pick: (threadId: string | null) => void): MenuEntry[] {
  const rows = [...threads].sort((a, b) => b.lastAt - a.lastAt);
  return [
    { head: "Reply in" },
    ...rows.map((t) => ({ label: t.subject, checked: current === t.threadId, onSelect: () => pick(t.threadId) })),
    { separator: true },
    { label: "New Email", checked: current === null, onSelect: () => pick(null) },
  ];
}
