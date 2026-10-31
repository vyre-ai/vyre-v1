import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { useObjectNames } from "../objects/names.ts";
import { PersonLifecycle } from "./PersonLifecycle.tsx";
import { Help,  Actions, Button, Field, FormSheet, Note, ReadState, Select, attempt, useAction, useRead } from "./shared.tsx";

type Roles = CapMap["access.roles.list"]["out"];
type Groups = CapMap["access.groups.list"]["out"];
type Principals = CapMap["access.principals.list"]["out"];
type Person = Principals["principals"][number];
type Bulk = { kind: "role" | "group" | "suspend"; value: string } | null;

/** The filters a person list offers: one status, role or group each. A row carries `status:`, `role:` and `group:` keys, so several filters narrow together. */
export function personFilters(people: readonly Person[], roles: Roles["roles"], groups: Groups["groups"]): { id: string; label: string }[] {
  const statuses = [...new Set(people.map((p) => p.status))].sort();
  return [
    ...statuses.map((status) => ({ id: `status:${status}`, label: `Status: ${status[0]!.toUpperCase()}${status.slice(1)}` })),
    ...roles.filter((role) => people.some((p) => p.roles.includes(role.id))).map((role) => ({ id: `role:${role.id}`, label: `Role: ${role.name}` })),
    ...groups.filter((group) => people.some((p) => p.groups.includes(group.id))).map((group) => ({ id: `group:${group.id}`, label: `Group: ${group.name}` })),
  ];
}
/** Permissions grouped by area: `records.edit` and `records.create` become records: create, edit. */
export function permissionAreas(permissions: readonly string[]): [string, string[]][] {
  const by = new Map<string, string[]>();
  for (const key of [...permissions].sort()) { const dot = key.indexOf("."); const area = dot < 0 ? key : key.slice(0, dot); (by.get(area) ?? by.set(area, []).get(area)!).push(dot < 0 ? key : key.slice(dot + 1)); }
  return [...by];
}
export const personRowFilters = (person: Person): string[] => [`status:${person.status}`, ...person.roles.map((id) => `role:${id}`), ...person.groups.map((id) => `group:${id}`)];

export function People({ initialPersonId }: { initialPersonId?: string } = {}): ReactElement {
  const consoleData = useConsoleData();
  const people = useRead<Principals>("access.principals.list", { kind: "person" });
  const roles = useRead<Roles>("access.roles.list");
  const groups = useRead<Groups>("access.groups.list", {});
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [link, setLink] = useState("");
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialPersonId ?? null);
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<Bulk>(null);
  const [report, setReport] = useState("");
  useEffect(() => setSelected(initialPersonId ?? null), [initialPersonId]);
  const refreshAll = (): void => { people.refresh(); groups.refresh(); };
  const action = useAction(refreshAll);
  if (!people.data || !roles.data || !groups.data) return <ReadState error={people.error ?? roles.error ?? groups.error} retry={() => { people.refresh(); roles.refresh(); groups.refresh(); }} />;
  const everyone = people.data.principals;
  const roleName = (id: string): string => roles.data?.roles.find((r) => r.id === id)?.name ?? "Role";
  const open = everyone.find((p) => p.id === selected) ?? null;
  if (open) return <PersonObject key={open.id} person={open} roles={roles.data.roles} groups={groups.data.groups} onBack={() => { setSelected(null); refreshAll(); }} refresh={refreshAll} />;
  if (selected) return <PersonById key={selected} id={selected} roles={roles.data.roles} groups={groups.data.groups} onBack={() => { setSelected(null); refreshAll(); }} refresh={refreshAll} />;
  const rows: ObjectListRow<Person>[] = everyone.map((person) => ({
    id: `console-person-${person.id}`, title: person.name === person.id ? "Person profile unavailable" : person.name,
    note: `${person.status[0]!.toUpperCase()}${person.status.slice(1)} · ${person.roles.map(roleName).join(", ") || "No role"}${person.groups.length ? ` · ${person.groups.length} ${person.groups.length === 1 ? "group" : "groups"}` : ""}`,
    search: `${person.title ?? ""}`, filters: personRowFilters(person), value: person,
    actions: [{ label: "Open", onSelect: () => setSelected(person.id) }],
  }));
  const pickedPeople = everyone.filter((p) => picked.has(`console-person-${p.id}`));
  const protectedIds = new Set([consoleData.me.id, ...everyone.filter((p) => p.roles.some((id) => id === "rol_owner" || id === "owner")).map((p) => p.id)]);
  const inviteRoles = roles.data.roles.filter((r) => r.id !== "rol_owner" && r.id !== "owner" && r.name.toLowerCase() !== "owner");
  const chosenRole = role || inviteRoles.find((r) => r.name === "Member")?.id || inviteRoles[0]?.id || "";
  const startBulk = (kind: "role" | "group" | "suspend"): void => { setReport(""); setBulk({ kind, value: kind === "role" ? inviteRoles[0]?.id ?? "" : kind === "group" ? groups.data!.groups[0]?.id ?? "" : "" }); };
  const applyBulk = async (): Promise<void> => {
    if (!bulk) return;
    const done: string[] = [], failed: string[] = [], skipped: string[] = [];
    for (const person of pickedPeople) {
      if (bulk.kind === "suspend" && (protectedIds.has(person.id) || person.status !== "active")) { skipped.push(person.name); continue; }
      if (bulk.kind === "role" && person.roles.includes(bulk.value)) { skipped.push(person.name); continue; }
      if (bulk.kind === "group" && person.groups.includes(bulk.value)) { skipped.push(person.name); continue; }
      const [cap, input] = bulk.kind === "role" ? ["access.roles.assign", { subject: { kind: "person", id: person.id }, roleId: bulk.value }]
        : bulk.kind === "group" ? ["access.groups.add_member", { groupId: bulk.value, member: { kind: "person", id: person.id } }]
        : ["members.suspend", { personId: person.id, ...(bulk.value.trim() ? { reason: bulk.value.trim() } : {}) }];
      const out = await action.run(cap!, input, "Done");
      (out === undefined ? failed : done).push(person.name);
    }
    setReport(`${done.length} changed${skipped.length ? `, ${skipped.length} skipped (${skipped.join(", ")})` : ""}${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""}.`);
    setPicked(new Set()); setBulk(null); refreshAll();
  };
  const bulkLabel = bulk?.kind === "role" ? `Assign ${roleName(bulk.value)}` : bulk?.kind === "group" ? `Add to ${groups.data.groups.find((g) => g.id === bulk.value)?.name ?? "group"}` : "Suspend";
  return <View testID="console-people">
    <Section title="People" count={rows.length} right={<Button label="Invite a person" testID="console-invite-open" onPress={() => setInviting(true)} />}>
      <ObjectList rows={rows} selectedId={null} onOpen={(row) => setSelected(row.value!.id)} filters={personFilters(everyone, roles.data.roles, groups.data.groups)} activeFilters={filters} onFilters={setFilters} picked={picked} onPicked={setPicked}
        bulkActions={[{ label: "Assign role…", onSelect: () => startBulk("role") }, { label: "Add to group…", onSelect: () => startBulk("group") }, { label: "Suspend…", onSelect: () => startBulk("suspend") }]} empty="No people match." testID="console-people-list" />
    </Section>
    {bulk && pickedPeople.length ? <Section title={`${bulkLabel} for ${pickedPeople.length} ${pickedPeople.length === 1 ? "person" : "people"}`} testID="people-bulk">
      <Group>
        {bulk.kind === "role" ? <Select label="Role" value={bulk.value} options={inviteRoles.map((r) => ({ key: r.id, title: r.name }))} onChange={(value) => setBulk({ ...bulk, value })} /> : null}
        {bulk.kind === "group" ? <Select label="Group" value={bulk.value} options={groups.data.groups.map((g) => ({ key: g.id, title: g.name }))} onChange={(value) => setBulk({ ...bulk, value })} /> : null}
        {bulk.kind === "suspend" ? <Field label="Reason (optional)" value={bulk.value} onChange={(value) => setBulk({ ...bulk, value })} testID="people-bulk-reason" /> : null}
        <Note>{bulk.kind === "suspend" ? "Suspending ends their sessions at once. You and the Space owner are skipped." : "People who already have this are skipped."} Each person is changed on its own; a refusal for one does not stop the rest.</Note>
        <Actions><Button label="Cancel" onPress={() => setBulk(null)} /><Button label={`Confirm: ${bulkLabel}`} testID="people-bulk-confirm" danger={bulk.kind === "suspend"} disabled={action.busy || !bulk.value && bulk.kind !== "suspend"} onPress={() => void applyBulk()} /></Actions>
      </Group>
    </Section> : null}
    {report ? <Note>{report}</Note> : null}
    {inviting ? <FormSheet title="Invite a person" testID="invite-sheet" onClose={() => { setInviting(false); setLink(""); }} submit={link ? "Done" : "Create invite"} disabled={!link && (!chosenRole || action.busy)} why={!chosenRole ? "Pick a role first" : undefined}
      onSubmit={() => { if (link) { setInviting(false); setLink(""); setEmail(""); return; } void action.run<CapMap["members.invites.create"]["out"]>("members.invites.create", { role: chosenRole, ...(email.trim() ? { email: email.trim() } : {}), idempotencyKey: attempt() }, "Invite created").then((out) => { if (out) setLink(out.link); }); }}>
      {link ? <><Note>Copy this one-time invite link:</Note><Text selectable testID="console-invite-link">{link}</Text></> : <><Field label="Email (optional)" testID="console-invite-email" value={email} onChange={setEmail} /><Select label="Role" value={chosenRole} options={inviteRoles.map((r) => ({ key: r.id, title: r.name }))} onChange={setRole} /></>}
    </FormSheet> : null}
    {action.note && !report ? <Note>{action.note}</Note> : null}
  </View>;
}

function PersonRoles({ personId }: { personId: string }): ReactElement {
  const data = useConsoleData();
  const [pending, setPending] = useState<{ roleId: string; held: boolean } | null>(null);
  const roles = useRead<Roles>("access.roles.list");
  const person = useRead<CapMap["access.principals.get"]["out"]>("access.principals.get", { principal: { kind: "person", id: personId } });
  const action = useAction(person.refresh);
  if (!roles.data || !person.data) return <ReadState error={roles.error ?? person.error} retry={() => { roles.refresh(); person.refresh(); }} />;
  const rows: ReactElement[] = [];
  for (const role of roles.data.roles) {
    const held = person.data.principal.roles.includes(role.id);
    rows.push(<Row key={role.id} id={`person-role-${role.id}`} title={role.name} note={held ? "Assigned" : "Not assigned"} trailing={role.id === "rol_owner" || role.id === "owner" ? <Button label="Transfer in Space settings" onPress={() => data.nav.openPage("space")} /> : <Button label={held ? "Remove role" : "Assign role"} disabled={action.busy} onPress={() => setPending({ roleId: role.id, held })} />} onPress={() => {if(role.id === "rol_owner" || role.id === "owner")data.nav.openPage("space");else setPending({ roleId: role.id, held });}} />);
  }
  return <Group>{rows}{pending ? <><Note>{pending.held ? "Remove" : "Assign"} this role for the selected person?</Note><Actions><Button label="Cancel" onPress={() => setPending(null)} /><Button label="Confirm role change" testID="console-person-role-confirm" disabled={action.busy} onPress={() => void action.run(pending.held ? "access.roles.unassign" : "access.roles.assign", { subject: { kind: "person", id: personId }, roleId: pending.roleId }, pending.held ? "Role removed" : "Role assigned").then((out) => { if (out) setPending(null); })} /></Actions></> : null}{action.note ? <Note>{action.note}</Note> : null}</Group>;
}

/** A person opened by link who is not in the loaded list (a page past the first, or a removed person): read them by id. */
function PersonById({ id, ...rest }: { id: string; roles: Roles["roles"]; groups: Groups["groups"]; onBack: () => void; refresh: () => void }): ReactElement {
  const one = useRead<CapMap["access.principals.get"]["out"]>("access.principals.get", { principal: { kind: "person", id } });
  if (!one.data) return <ReadState error={one.error} retry={one.refresh} />;
  return <PersonObject person={one.data.principal} {...rest} />;
}

function PersonObject({ person, roles, groups, onBack, refresh }: { person: Person; roles: Roles["roles"]; groups: Groups["groups"]; onBack: () => void; refresh: () => void }): ReactElement {
  const [tab, setTab] = useState("overview");
  const effective = useRead<CapMap["access.principals.effective"]["out"]>("access.principals.effective", { principal: { kind: "person", id: person.id } });
  const devices = useRead<CapMap["devices.list"]["out"]>("devices.list", { person: person.id });
  const activity = useRead<CapMap["audit.list"]["out"]>("audit.list", { actor: { kind: "person", id: person.id }, limit: 50 });
  const names = useObjectNames({ identities: [], resources: effective.data ? [...effective.data.owns, ...effective.data.grants.map((g) => g.resource)] : [] });
  const [addGroup, setAddGroup] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const action = useAction(() => { refresh(); effective.refresh(); devices.refresh(); });
  const mine = groups.filter((g) => person.groups.includes(g.id));
  const free = groups.filter((g) => !person.groups.includes(g.id));
  const roleName = (id: string): string => roles.find((r) => r.id === id)?.name ?? "Role";
  const name = person.name === person.id ? "Person profile unavailable" : person.name;
  let body: ReactElement;
  if (tab === "access") {
    body = <ObjectSection title="Effective access" count={effective.data?.permissions.length ?? 0} testID="person-effective">
      {effective.data ? <>
        <Row id="person-eff-roles" title="Roles" note={effective.data.roles.map(roleName).join(", ") || "No roles"} />
        <View testID="person-eff-permissions" style={{ paddingHorizontal: 8, paddingVertical: 6, gap: 4 }}>
          <Text style={{ fontSize: 13, color: "var(--ink)" as string }}>Permissions</Text>
          {/* ui-rows-lint: not a list (one wrapping line per permission area; a Row would cut the actions off) */}
          {permissionAreas(effective.data.permissions).map(([area, actions]) => <Text key={area} style={{ fontSize: 12, color: "var(--ink-3)" as string }}><Text style={{ fontWeight: "600", color: "var(--ink-2)" as string }}>{area}</Text>{`  ${actions.join(", ")}`}</Text>)}
        </View>
        {effective.data.grants.map((grant) => <Row key={grant.id} id={`person-grant-${grant.id}`} title={names.resource(grant.resource)} note={`${grant.level} · direct grant`} />)}
        {effective.data.owns.map((own) => <Row key={`${own.type}:${own.id}`} id={`person-owns-${own.id}`} title={names.resource(own)} note="Owns" />)}
        {effective.data.grants.length + effective.data.owns.length === 0 ? <Note>No direct grants and nothing owned. Access comes from roles and groups.</Note> : null}
      </> : <ReadState error={effective.error} retry={effective.refresh} />}
    </ObjectSection>;
  } else if (tab === "groups") {
    body = <ObjectSection title="Groups" count={mine.length} testID="person-groups">
      {mine.map((group) => <Row key={group.id} id={`person-group-${group.id}`} title={group.name} note={group.builtIn ? "Built-in group" : `${group.members.length} members`} trailing={<Button label="Remove" disabled={action.busy} onPress={() => void action.run("access.groups.remove_member", { groupId: group.id, member: { kind: "person", id: person.id } }, "Removed from group")} />} />)}
      {mine.length === 0 ? <Note>Not in any group.</Note> : null}
      {free.length ? <><Select label="Add to a group" value={addGroup || free[0]!.id} options={free.map((g) => ({ key: g.id, title: g.name }))} onChange={setAddGroup} /><Button label="Add to group" testID="person-group-add" disabled={action.busy} onPress={() => void action.run("access.groups.add_member", { groupId: addGroup || free[0]!.id, member: { kind: "person", id: person.id } }, "Added to group").then(() => setAddGroup(""))} /></> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </ObjectSection>;
  } else if (tab === "devices") {
    const live = devices.data?.devices.filter((d) => !d.revokedAt) ?? [];
    body = <ObjectSection title="Devices" count={live.length} testID="person-devices">
      {devices.data ? <>
        {live.map((device) => <Row key={device.id} id={`person-device-${device.id}`} title={device.name} note={`${device.class}${device.lastSeenAt ? ` · last seen ${new Date(device.lastSeenAt).toLocaleString()}` : ""}${device.location ? ` · ${device.location}` : ""}`} trailing={revoking === device.id ? <Actions><Button label="Cancel" onPress={() => setRevoking(null)} /><Button label="Confirm revoke" testID={`person-device-revoke-confirm-${device.id}`} danger disabled={action.busy} onPress={() => void action.run("devices.revoke", { deviceId: device.id }, "Device revoked").then(() => setRevoking(null))} /></Actions> : <Button label="Revoke…" onPress={() => setRevoking(device.id)} />} />)}
        {live.length === 0 ? <Note>No signed-in devices.</Note> : <Help>Revoking ends the device’s sessions and purges its local copy on next contact.</Help>}
      </> : <ReadState error={devices.error} retry={devices.refresh} />}
      {action.note ? <Note>{action.note}</Note> : null}
    </ObjectSection>;
  } else if (tab === "activity") {
    body = <ObjectSection title="Activity" count={activity.data?.rows.length ?? 0}>{activity.data ? (activity.data.rows.length ? activity.data.rows.map((row) => <Row key={row.id} id={`person-activity-${row.id}`} title={row.action} note={`${row.class} · ${new Date(row.at).toLocaleString()}`} />) : <Note>No recorded activity for this person.</Note>) : <ReadState error={activity.error} retry={activity.refresh} />}</ObjectSection>;
  } else {
    body = <View testID="person-overview"><Section title="Roles"><PersonRoles personId={person.id} /></Section><PersonLifecycle personId={person.id} refresh={refresh} /></View>;
  }
  return <ObjectPage id={person.id} name={name} kind="Person" owner={person.title ?? (person.roles.map(roleName).join(", ") || "No role")} status={person.status} parent="People" onBack={onBack} density="regular" actions={[]} tabs={withBaseTabs([{ id: "groups", label: "Groups", count: mine.length }, { id: "devices", label: "Devices", count: devices.data ? devices.data.devices.filter((d) => !d.revokedAt).length : null }])} activeTabId={tab} onTab={setTab} sheetOpen={false} testID="person-object">{body}</ObjectPage>;
}
