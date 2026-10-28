import {PersonLifecycle} from "./PersonLifecycle.tsx";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { useConsoleData } from "../shell/data.tsx";

type Roles = CapMap["access.roles.list"]["out"];
type People = CapMap["access.principals.list"]["out"];
export function People({initialPersonId}:{initialPersonId?:string}={}): ReactElement {
  const people = useRead<People>("access.principals.list", { kind: "person" });
  const roles = useRead<Roles>("access.roles.list");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [link, setLink] = useState("");
  const [selected, setSelected] = useState<string | null>(initialPersonId??null);
  useEffect(()=>setSelected(initialPersonId??null),[initialPersonId]);
  const action = useAction(people.refresh);
  if (!people.data || !roles.data) return <ReadState error={people.error ?? roles.error} retry={() => { people.refresh(); roles.refresh(); }} />;
  const rows: ReactElement[] = [];
  for (const person of people.data.principals) rows.push(<Row key={person.id} id={`console-person-${person.id}`} title={person.name===person.id?"Person profile unavailable":person.name} note={`${person.status} · ${person.roles.map((id) => roles.data?.roles.find((r) => r.id === id)?.name ?? "Role").join(", ")}`} onPress={() => { setSelected(person.id); }} />);
  const roleRows: ReactElement[] = [];
  for (const item of roles.data.roles.filter(role=>role.id!=="rol_owner"&&role.id!=="owner"&&role.name.toLowerCase()!=="owner")) roleRows.push(<Row key={item.id} id={`invite-role-${item.id}`} title={item.name} selected={role === item.id} onPress={() => setRole(item.id)} />);
  return <View testID="console-people"><Section title="People" count={rows.length}><Group>{rows.length ? rows : <Note>No people.</Note>}</Group></Section><Section title="Invite a person"><Group><Field label="Email (optional)" testID="console-invite-email" value={email} onChange={setEmail} />{roleRows}<Button label="Create invite" testID="console-invite-create" disabled={!role || action.busy} onPress={() => void action.run<CapMap["members.invites.create"]["out"]>("members.invites.create", { role, ...(email.trim() ? { email: email.trim() } : {}), idempotencyKey: attempt() }, "Invite created").then((out) => { if (out) setLink(out.link); })} />{link ? <><Note>Copy this one-time invite link:</Note><Text selectable testID="console-invite-link">{link}</Text></> : null}</Group></Section>{selected ? <Section title="Selected person"><PersonRoles personId={selected} /><PersonLifecycle key={selected} personId={selected} refresh={people.refresh} /></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
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
export function Roles(): ReactElement {
  const data = useConsoleData();
  const list = useRead<Roles>("access.roles.list");
  const [selected, setSelected] = useState<Roles["roles"][number] | null>(null);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState("");
  const [preview, setPreview] = useState<CapMap["access.roles.preview"]["out"] | null>(null);
  const [error, setError] = useState("");
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows: ReactElement[] = [];
  for (const role of list.data.roles) rows.push(<Row key={role.id} id={`console-role-${role.id}`} title={role.name} note={`${role.holders} holders · ${role.permissions.length} permissions${role.builtIn ? " · Built-in" : ""}`} onPress={() => { setSelected(role); setPermissions(role.permissions.join("\n")); setName(`${role.name} copy`); setPreview(null); }} />);
  return <View testID="console-roles"><Group>{rows}</Group>{selected ? <Section title={selected.name}><Group><Field label="Name for a copy" testID="console-role-name" value={name} onChange={setName} /><Button label="Clone role" disabled={!name.trim() || action.busy} onPress={() => void action.run("access.roles.create", { cloneFrom: selected.id, name: name.trim(), idempotencyKey: attempt() }, "Role cloned")} /><Field multiline label="Permissions (one key per line)" testID="console-role-permissions" value={permissions} onChange={(value) => { setPermissions(value); setPreview(null); }} />{selected.builtIn ? <Note>Clone this built-in role before changing its permissions.</Note> : <Button label="Preview changes" testID="console-role-preview" onPress={() => { setError(""); void data.call("access.roles.preview", { roleId: selected.id, permissions: permissions.split(/[\n,]/).map((p) => p.trim()).filter(Boolean) }).then((out) => setPreview(out as CapMap["access.roles.preview"]["out"]), () => setError("Couldn’t preview this role change.")); }} />}{preview ? <><Note>{preview.gains.length} permission gains; {preview.losses.length} losses. Apply this exact preview?</Note><Button label="Apply changes" testID="console-role-apply" disabled={action.busy} onPress={() => void action.run("access.roles.apply", { roleId: selected.id, permissions: permissions.split(/[\n,]/).map((p) => p.trim()).filter(Boolean), previewHash: preview.previewHash }, "Role updated").then((out) => { if (out) setPreview(null); })} /></> : null}{error ? <Note>{error}</Note> : null}</Group></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
export {Grants} from "./Grants.tsx";
