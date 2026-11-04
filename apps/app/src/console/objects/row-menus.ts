// The right-click menus of the Console's rows (lane l-chrome2a; team/v1/CONTEXT-MENUS.md): a person, a group, a role, a number, a domain. Each page hands its row's facts and what the page can do; the entries are the
// ones of chats/menus/kinds-b.ts, without "Open" (the list adds it first). What needs a picker or a wizard (Change Role, Add Person, Assign, Remove from Space) opens the object, where that lives; what is one call is
// one call. Anything that removes asks first (ObjectList).
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { consoleDomainMenu, consoleGroupMenu, consoleNumberMenu, consolePersonMenu, consoleRoleMenu } from "../../places/chats/menus/kinds-b.ts";
import { copyToClipboard } from "../../places/chats/menus/actions-b.ts";
import type { MenuApiB } from "../../places/chats/menus/actions-b.ts";

/** The menu without its first "Open" and the separator after it: ObjectList draws Open itself. */
export function afterOpen(entries: readonly MenuEntry[]): MenuEntry[] {
  const rest = entries.filter((e, i) => !(i === 0 && "label" in e && e.label === "Open"));
  return rest[0] !== undefined && "separator" in rest[0] ? rest.slice(1) : rest;
}

export interface RowDeps { api: MenuApiB; can(perm: string): boolean; open(): void; done(note?: string): void; fail(e: unknown): void }
const once = (d: RowDeps, run: () => Promise<void>, note?: string): void => void run().then(() => d.done(note), d.fail);

export function personRowActions(p: { id: string; name: string; status: string; roles: readonly string[] }, me: string, d: RowDeps): MenuEntry[] {
  return afterOpen(consolePersonMenu(
    { name: p.name, manage: d.can("members.remove"), suspended: p.status === "suspended", self: p.id === me, owner: p.roles.some((r) => r === "rol_owner" || r === "owner") },
    {
      open: d.open, copyName: () => copyToClipboard(p.name),
      suspend: () => once(d, () => d.api.personSuspend(p.id), `${p.name} suspended`), reactivate: () => once(d, () => d.api.personReactivate(p.id), `${p.name} reactivated`),
      changeRole: d.open, remove: d.open,
    },
  ));
}

export function groupRowActions(g: { id: string; name: string; builtIn: boolean }, d: RowDeps & { rename(): void }): MenuEntry[] {
  return afterOpen(consoleGroupMenu(
    { name: g.name, manage: d.can("access.manage"), builtIn: g.builtIn },
    { open: d.open, copyName: () => copyToClipboard(g.name), addPerson: d.open, rename: d.rename, remove: () => once(d, () => d.api.groupDelete(g.id), `${g.name} deleted`) },
  ));
}

export function roleRowActions(r: { id: string; name: string; builtIn: boolean; holders: number }, d: RowDeps): MenuEntry[] {
  return afterOpen(consoleRoleMenu(
    { name: r.name, manage: d.can("access.manage"), builtIn: r.builtIn, holders: r.holders },
    { open: d.open, copyName: () => copyToClipboard(r.name), duplicate: () => once(d, () => d.api.roleDuplicate(r.id, `${r.name} copy`), `Made ${r.name} copy`), preview: d.open, remove: () => once(d, () => d.api.roleDelete(r.id), `${r.name} deleted`) },
  ));
}

export function numberRowActions(n: { id: string; name: string; e164: string }, d: RowDeps): MenuEntry[] {
  return afterOpen(consoleNumberMenu(
    { name: n.name, manage: d.can("comms.numbers") },
    { open: d.open, copyNumber: () => copyToClipboard(n.e164), assign: d.open, release: () => once(d, () => d.api.numberRelease(n.id), `${n.e164} released`) },
  ));
}

export function domainRowActions(x: { id: string; name: string }, d: RowDeps): MenuEntry[] {
  return afterOpen(consoleDomainMenu(
    { name: x.name, manage: d.can("comms.domains") },
    { open: d.open, copyName: () => copyToClipboard(x.name), check: () => once(d, () => d.api.domainCheck(x.id), `Checked ${x.name}`), remove: () => once(d, () => d.api.domainRemove(x.id), `${x.name} removed`) },
  ));
}
