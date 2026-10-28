import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { AccessGroupsGetOut, AccessGroupsListOut, AccessPrincipalsListOut, AccessRolesListOut, AuditListOut } from "../../../../../generated/types.ts";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";

type GroupRow = AccessGroupsListOut["groups"][number];
type Person = AccessPrincipalsListOut["principals"][number];
type Ref = GroupRow["members"][number];
export function groupActivityLabel(action: string): string {
  const labels: Record<string, string> = { "access.groups.create": "Group created", "access.groups.update": "Group details changed", "access.groups.add_member": "Member added", "access.groups.remove_member": "Member removed", "access.groups.delete": "Group deleted", "access.roles.assign": "Role assigned", "access.roles.unassign": "Role removed" };
  return labels[action] ?? action.replace(/[._]/g, " ");
}
export function groupDeleteImpact(group: GroupRow, grants: number): string {
  return `Delete ${group.name}? ${group.members.length} memberships, ${group.managers.length} manager assignments and ${grants} direct grants end. Access through this group's roles ends for its members. This cannot be undone.`;
}
export function mergeGroupRows(first: readonly GroupRow[], more: readonly GroupRow[]): GroupRow[] {
  const rows = new Map(first.map((row) => [row.id, row]));
  for (const row of more) rows.set(row.id, row);
  return [...rows.values()];
}

export function Groups({ initialId }: { initialId?: string }): ReactElement {
  const data = useConsoleData();
  const [selected, setSelected] = useState(initialId ?? "");
  const [search, setSearch] = useState("");
  const searchNow = useRef(search); searchNow.current = search;
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [more, setMore] = useState<{ rows: GroupRow[]; next?: string } | null>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState("");
  const [bulk, setBulk] = useState<AccessGroupsGetOut[] | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const list = useRead<AccessGroupsListOut>("access.groups.list", { q: search, limit: 100 });
  const refresh = () => { setMore(null); list.refresh(); };
  const action = useAction(refresh);
  useEffect(() => { setSelected(initialId ?? ""); }, [initialId]);
  useEffect(() => { setMore(null); setPicked(new Set()); }, [search]);
  const open = (id: string) => { setSelected(id); data.nav.openPage("groups", { groupId: id }); };
  if (selected) return <GroupObject key={selected} groupId={selected} onBack={() => { setSelected(""); data.nav.openPage("groups"); refresh(); }} />;
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows = mergeGroupRows(list.data.groups, more?.rows ?? []);
  const next = more ? more.next : list.data.next;
  const prepareBulk = async () => {
    setPageError("");
    const custom = rows.filter((group) => picked.has(group.id) && !group.builtIn);
    if (!custom.length) { setPageError("Built-in groups cannot be deleted. Select a custom group."); return; }
    try { setBulk(await Promise.all(custom.map((group) => data.call("access.groups.get", {groupId: group.id}) as Promise<AccessGroupsGetOut>))); }
    catch { setPageError("Couldn’t load deletion impact. No groups were changed."); }
  };
  const loadMore = async () => {
    if (!next || paging) return;
    setPaging(true); setPageError("");
    try {
      const out = await data.call("access.groups.list", { q: search, cursor: next, limit: 100 }) as AccessGroupsListOut;
      if (searchNow.current !== search) return;
      setMore({ rows: mergeGroupRows(more?.rows ?? [], out.groups), ...(out.next ? { next: out.next } : {}) });
    } catch { setPageError("Couldn’t load more groups. Try again."); }
    finally { setPaging(false); }
  };
  return <View testID="console-groups"><Actions><Button label="Create group" testID="group-create-open" onPress={() => setCreate(true)} /></Actions>
    <ObjectList rows={rows.map((group) => ({ id: group.id, title: group.name, note: `${group.members.length} members · ${group.managers.length} managers`, filters: [group.builtIn ? "built-in" : "custom"], actions: [{ label: "Open group", onSelect: () => open(group.id) }], value: group }))} selectedId={null} onOpen={(row) => open(row.id)} search={{ value: search, onSearch: setSearch }} filters={[{ id: "built-in", label: "Built-in" }, { id: "custom", label: "Custom" }]} activeFilters={filters} onFilters={setFilters} picked={picked} onPicked={setPicked} bulkActions={[{ label: "Delete selected custom groups…", danger: true, onSelect: () => void prepareBulk() }]} pagination={{ ...(next ? { next } : {}), busy: paging, onMore: () => void loadMore() }} empty="No groups match this search." testID="group-list" />
    {bulk ? <Section title="Confirm group deletion"><Note>{bulk.map((item) => groupDeleteImpact(item.group, item.grants.length)).join(" ")}</Note><Actions><Button label="Cancel" onPress={() => setBulk(null)} /><Button label="Delete selected groups" danger disabled={action.busy} onPress={() => { void (async () => { for (const item of bulk) { const out = await action.run("access.groups.delete", {groupId: item.group.id}, "Group deleted"); if (!out) { setPageError("Deletion stopped. Earlier successful deletions remain; reload before retrying."); setBulk(null); return; } } setBulk(null); setPicked(new Set()); })(); }} /></Actions></Section> : null}{pageError ? <Note>{pageError}</Note> : null}{create ? <Section title="Create group"><Field label="Group name" value={name} onChange={setName} testID="group-name" /><Actions><Button label="Cancel" onPress={() => setCreate(false)} /><Button label="Create" testID="group-create" disabled={!name.trim() || action.busy} onPress={() => void action.run<{ group: GroupRow }>("access.groups.create", { name: name.trim(), idempotencyKey: attempt() }, "Group created").then((out) => { if (out) { setCreate(false); setName(""); open(out.group.id); } })} /></Actions></Section> : null}{action.note ? <Note>{action.note}</Note> : null}
  </View>;
}

function GroupObject({ groupId, onBack }: { groupId: string; onBack: () => void }): ReactElement {
  const data = useConsoleData();
  const detail = useRead<AccessGroupsGetOut>("access.groups.get", { groupId });
  const roles = useRead<AccessRolesListOut>("access.roles.list", { limit: 500 });
  const [tab, setTab] = useState("overview");
  const [pendingRole, setPendingRole] = useState<AccessRolesListOut["roles"][number] | null>(null);
  const [sheet, setSheet] = useState<"edit" | "members" | "managers" | null>(null);
  const [name, setName] = useState("");
  const [managerIds, setManagerIds] = useState<ReadonlySet<string>>(new Set());
  const action = useAction(detail.refresh);
  if (!detail.data) return <ReadState error={detail.error} retry={detail.refresh} />;
  const current = detail.data;
  const group = current.group;
  const actions = [{ id: "members", label: "Add members", destructive: false }, { id: "managers", label: "Change managers", destructive: false }, ...(!group.builtIn ? [{ id: "edit", label: "Rename", destructive: false }, { id: "delete", label: "Delete group", destructive: true }] : [])];
  const run = async (id: string): Promise<boolean | void> => {
    if (id === "delete") {
      const out = await action.run("access.groups.delete", { groupId }, "Group deleted");
      if (!out) return false;
      onBack(); return true;
    }
    setName(group.name); setManagerIds(new Set(group.managers.map((manager) => manager.id))); setSheet(id as typeof sheet);
  };
  return <ObjectPage id={group.id} name={group.name} kind="Group" owner={group.managers.map((manager) => data.name(manager.id)).join(", ") || data.space.name} status={group.builtIn ? "Built-in" : "Active"} actions={actions} tabs={withBaseTabs([{ id: "members", label: "Members", count: group.members.length }, { id: "managers", label: "Managers", count: group.managers.length }])} activeTabId={tab} onTab={setTab} density="regular" parent="Groups" onBack={onBack} sheetOpen={sheet !== null} sheetTitle={sheet === "edit" ? "Rename group" : sheet === "members" ? "Add members" : "Change managers"} onCloseSheet={() => setSheet(null)} onAction={run} impacts={{ delete: groupDeleteImpact(group, current.grants.length) }} testID="group-object" sheet={sheet === "edit" ? <><Field label="Group name" value={name} onChange={setName} testID="group-edit-name" /><Button label="Save name" testID="group-save-name" disabled={action.busy || !name.trim()} onPress={() => void action.run("access.groups.update", { groupId, name: name.trim() }, "Group renamed").then((out) => { if (out) setSheet(null); })} /></> : sheet === "members" ? <PrincipalPicker mode="member" selected={new Set(group.members.map((member) => member.id))} onPick={(person) => void action.run("access.groups.add_member", { groupId, member: { kind: person.kind, id: person.id } }, "Member added")} /> : sheet === "managers" ? <><PrincipalPicker mode="manager" selected={managerIds} onPick={(person) => setManagerIds((previous) => { const next = new Set(previous); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} /><Button label="Save managers" testID="group-save-managers" disabled={action.busy} onPress={() => void action.run("access.groups.update", { groupId, managers: [...managerIds].map((id) => ({ kind: "person", id })) }, "Managers updated").then((out) => { if (out) setSheet(null); })} /></> : null}>
    {tab === "overview" ? <><ObjectSection title="Membership"><Note>{group.members.length} people and agents. Groups have one level; they cannot contain other groups.</Note><Button label="Open members" onPress={() => setTab("members")} /></ObjectSection><ObjectSection title="Access"><Note>{current.roles.length} direct roles · {current.grants.length} direct grants. Members inherit both.</Note><Button label="Review access" onPress={() => setTab("access")} /></ObjectSection></> : null}
    {tab === "members" ? <MemberRows members={group.members} groupId={groupId} refresh={detail.refresh} /> : null}
    {tab === "managers" ? <Group>{group.managers.length ? group.managers.map((manager) => <Row key={manager.id} id={`manager-${manager.id}`} title={data.name(manager.id)} note="Manager" onPress={() => { setManagerIds(new Set(group.managers.map((item) => item.id))); setSheet("managers"); }} />) : <Note>No managers assigned.</Note>}</Group> : null}
    {tab === "access" ? <><ObjectSection title="Roles">{roles.data ? <Group>{roles.data.roles.map((role) => <Row key={role.id} id={`group-role-${role.id}`} title={role.name} note={`${current.roles.includes(role.id) ? "Assigned" : "Not assigned"} · ${role.permissions.length} permissions · ${role.assignableToAgents ? "People and agents" : "People only"}`} trailing={<Button label={current.roles.includes(role.id) ? "Remove role…" : "Assign role…"} onPress={() => setPendingRole(role)} />} onPress={() => setPendingRole(role)} />)}{pendingRole ? <><Note>{current.roles.includes(pendingRole.id) ? "Remove" : "Assign"} {pendingRole.name} for every group member? The server checks agent eligibility before changing access.</Note><Actions><Button label="Cancel" onPress={() => setPendingRole(null)} /><Button label="Confirm role change" disabled={action.busy} testID={`group-role-confirm-${pendingRole.id}`} onPress={() => void action.run(current.roles.includes(pendingRole.id) ? "access.roles.unassign" : "access.roles.assign", { roleId: pendingRole.id, subject: { kind: "group", id: groupId } }, "Group role updated").then((out) => { if (out) setPendingRole(null); })} /></Actions></> : null}</Group> : <ReadState error={roles.error} retry={roles.refresh} />}</ObjectSection><ObjectSection title="Direct grants"><Group>{current.grants.length ? current.grants.map((grant) => <Row key={grant.id} id={`group-grant-${grant.id}`} title={`${grant.level} · ${data.name(grant.resource.id)}`} note={`${grant.resource.type} · granted by ${data.name(grant.by)}${grant.conditions.expiresAt ? ` · expires ${new Date(grant.conditions.expiresAt).toLocaleDateString()}` : ""}`} onPress={() => data.nav.openPage("grants", { resourceType: grant.resource.type, resourceId: grant.resource.id })} />) : <Note>No direct grants.</Note>}</Group></ObjectSection></> : null}
    {tab === "activity" ? <GroupActivity groupId={groupId} /> : null}{action.note ? <Note>{action.note}</Note> : null}
  </ObjectPage>;
}

function MemberRows({ members, groupId, refresh }: { members: Ref[]; groupId: string; refresh: () => void }): ReactElement {
  const data = useConsoleData();
  const [pending, setPending] = useState<Ref | null>(null);
  const action = useAction(refresh);
  return <Group>{members.map((member) => <Row key={member.id} id={`member-${member.id}`} title={data.name(member.id)} note={member.kind} trailing={<Button label="Remove…" danger onPress={() => setPending(member)} />} onPress={() => setPending(member)} />)}{!members.length ? <Note>No members yet.</Note> : null}{pending ? <><Note>Remove {data.name(pending.id)}? Access inherited through this group ends. Other access remains.</Note><Actions><Button label="Cancel" onPress={() => setPending(null)} /><Button label="Confirm remove member" disabled={action.busy} testID="group-member-remove-confirm" onPress={() => void action.run("access.groups.remove_member", { groupId, member: pending }, "Member removed").then((out) => { if (out) setPending(null); })} /></Actions></> : null}{action.note ? <Note>{action.note}</Note> : null}</Group>;
}
function PrincipalPicker({ mode, selected, onPick }: { mode: "member" | "manager"; selected: ReadonlySet<string>; onPick: (principal: Person) => void }): ReactElement {
  const [search, setSearch] = useState("");
  const searchNow = useRef(search); searchNow.current = search;
  const list = useRead<AccessPrincipalsListOut>("access.principals.list", { q: search, status: "active", limit: 100, ...(mode === "manager" ? { kind: "person" } : {}) });
  const [more, setMore] = useState<AccessPrincipalsListOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = useConsoleData();
  useEffect(() => { setMore(null); }, [search]);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const people = [...list.data.principals, ...(more?.principals ?? [])].filter((person, index, all) => all.findIndex((row) => row.id === person.id) === index && (person.kind === "person" || mode === "member" && person.kind === "agent"));
  const next = more ? more.next : list.data.next;
  return <><Field label="Find a person or agent" value={search} onChange={setSearch} testID="group-principal-search" /><Group>{people.map((person) => <Row key={person.id} id={`pick-${person.id}`} title={person.name} note={`${person.kind}${selected.has(person.id) ? " · Selected" : ""}`} trailing={<Button label={selected.has(person.id) ? mode === "member" ? "Added" : "Remove selection" : "Select"} disabled={mode === "member" && selected.has(person.id)} onPress={() => onPick(person)} />} onPress={() => { if (mode === "manager" || !selected.has(person.id)) onPick(person); }} />)}</Group>{!people.length ? <Note>No matching people or agents.</Note> : null}{next ? <Button label="Load more people" disabled={busy} onPress={() => { setBusy(true); setError(""); void data.call("access.principals.list", { q: search, status: "active", limit: 100, cursor: next, ...(mode === "manager" ? { kind: "person" } : {}) }).then((value) => { const out = value as AccessPrincipalsListOut; if (searchNow.current !== search) return; setMore({ ...out, principals: [...(more?.principals ?? []), ...out.principals] }); }, () => setError("Couldn’t load more people.")).finally(() => setBusy(false)); }} /> : null}{error ? <Note>{error}</Note> : null}</>;
}
function GroupActivity({ groupId }: { groupId: string }): ReactElement {
  const data = useConsoleData();
  const query = useRead<AuditListOut>("audit.list", { target: { kind: "group", id: groupId }, limit: 50 });
  const [more, setMore] = useState<AuditListOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!query.data) return <ReadState error={query.error} retry={query.refresh} />;
  const rows = [...query.data.rows, ...(more?.rows ?? [])];
  const next = more ? more.next : query.data.next;
  return <ObjectSection title="Activity"><Group>{rows.map((row) => <Row key={row.id} id={`activity-${row.id}`} title={groupActivityLabel(row.action)} note={`${data.name(row.actor.id)} · ${new Date(row.at).toLocaleString()}${row.onBehalfOf ? ` · on behalf of ${data.name(row.onBehalfOf.id)}` : ""}`} />)}{!rows.length ? <Note>No recorded changes to this group.</Note> : null}</Group>{next ? <Button label="Load earlier activity" disabled={busy} onPress={() => { setBusy(true); setError(""); void data.call("audit.list", { target: { kind: "group", id: groupId }, cursor: next, limit: 50 }).then((value) => { const out = value as AuditListOut; setMore({ ...out, rows: [...(more?.rows ?? []), ...out.rows] }); }, () => setError("Couldn’t load earlier activity.")).finally(() => setBusy(false)); }} /> : null}{error ? <Note>{error}</Note> : null}</ObjectSection>;
}
