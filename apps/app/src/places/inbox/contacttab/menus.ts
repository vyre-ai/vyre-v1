// The contact tab's menus, as data, so a test can read them without a click.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { InboxChoice } from "./model.ts";

/** Header actions: the pure part, so the menus can be tested without a click. */
export function followMenuEntries(followed: boolean, alertOnReplies: boolean, on: { follow(follow: boolean): void; alert(alert: boolean): void }): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: followed ? "Unfollow" : "Follow", onSelect: () => on.follow(!followed) }];
  if (followed) entries.push({ label: "Alert me on replies", checked: alertOnReplies, onSelect: () => on.alert(!alertOnReplies) });
  return entries;
}

export function fromMenuEntries(choices: readonly InboxChoice[], current: string | null, cameIn: readonly string[], pick: (id: string) => void): MenuEntry[] {
  return [{ head: "Send from" }, ...choices.map((c) => ({ label: cameIn.includes(c.id) ? `${c.label} (this thread)` : c.label, checked: c.id === current, onSelect: () => pick(c.id) }))];
}

/** The template button: each template inserts its text at the foot of the draft. */
export function templateEntries(templates: readonly { t: string; body: string }[], insert: (body: string) => void): MenuEntry[] {
  const rows = templates;
  if (rows.length === 0) return [{ label: "No templates yet" }];
  return [{ head: "Templates" }, ...rows.map((r) => ({ label: r.t, onSelect: () => insert(r.body) }))];
}

/** The quick-action button: the things a person does next with this contact. */
export function quickEntries(hasRecord: boolean, on: { dial(): void; openRecord(): void; attach(): void }): MenuEntry[] {
  return [
    { label: "Call", onSelect: on.dial },
    { label: "Attach from Files", onSelect: on.attach },
    ...(hasRecord ? [{ label: "Open the record", onSelect: on.openRecord }] : []),
  ];
}
