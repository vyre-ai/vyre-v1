import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { useConsoleData } from "../shell/data.tsx";

type Roles = CapMap["access.roles.list"]["out"];
type People = CapMap["access.principals.list"]["out"];
export function People(): ReactElement {
  const people = useRead<People>("access.principals.list", { kind: "person" });
  const roles = useRead<Roles>("access.roles.list");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [link, setLink] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const action = useAction(people.refresh);
  if (!people.data || !roles.data) return <ReadState error={people.error ?? roles.error} retry={() => { people.refresh(); roles.refresh(); }} />;
  const rows: ReactElement[] = [];
  for (const person of people.data.principals) rows.push(<Row key={person.id} id={`console-person-${person.id}`} title={person.name} note={`${person.status} · ${person.roles.map((id) => roles.data?.roles.find((r) => r.id === id)?.name ?? id).join(", ")}`} onPress={() => { setSelected(person.id); setConfirmSuspend(false); }} />);
  const roleRows: ReactElement[] = [];
  for (const item of roles.data.roles) roleRows.push(<Row key={item.id} id={`invite-role-${item.id}`} title={item.name} selected={role === item.id} onPress={() => setRole(item.id)} />);
  return <View testID="console-people"><Section title="People" count={rows.length}><Group>{rows.length ? rows : <Note>No people.</Note>}</Group></Section><Section title="Invite a person"><Group><Field label="Email (optional)" testID="console-invite-email" value={email} onChange={setEmail} />{roleRows}<Button label="Create invite" testID="console-invite-create" disabled={!role || action.busy} onPress={() => void action.run<CapMap["members.invites.create"]["out"]>("members.invites.create", { role, ...(email.trim() ? { email: email.trim() } : {}), idempotencyKey: attempt() }, "Invite created").then((out) => { if (out) setLink(out.link); })} />{link ? <><Note>Copy this one-time invite link:</Note><Text selectable testID="console-invite-link">{link}</Text></> : null}</Group></Section>{selected ? <Section title="Selected person"><PersonRoles personId={selected} /><Button label="Suspend…" danger onPress={() => setConfirmSuspend(true)} />{confirmSuspend ? <><Note>Suspending this person ends access and purges their devices on next contact.</Note><Actions><Button label="Cancel" onPress={() => setConfirmSuspend(false)} /><Button label="Confirm suspension" danger disabled={action.busy} onPress={() => void action.run("members.suspend", { personId: selected }, "Person suspended").then((out) => { if (out) setConfirmSuspend(false); })} /></Actions></> : null}</Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
function PersonRoles({ personId }: { personId: string }): ReactElement {
  const [pending, setPending] = useState<{ roleId: string; held: boolean } | null>(null);
  const roles = useRead<Roles>("access.roles.list");
  const person = useRead<CapMap["access.principals.get"]["out"]>("access.principals.get", { principal: { kind: "person", id: personId } });
  const action = useAction(person.refresh);
  if (!roles.data || !person.data) return <ReadState error={roles.error ?? person.error} retry={() => { roles.refresh(); person.refresh(); }} />;
  const rows: ReactElement[] = [];
  for (const role of roles.data.roles) {
    const held = person.data.principal.roles.includes(role.id);
    rows.push(<Row key={role.id} id={`person-role-${role.id}`} title={role.name} note={held ? "Assigned" : "Not assigned"} trailing={<Button label={held ? "Remove role" : "Assign role"} disabled={action.busy} onPress={() => setPending({ roleId: role.id, held })} />} onPress={() => setPending({ roleId: role.id, held })} />);
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
export function Grants({ initialResource }: { initialResource?: { type: string; id: string } }): ReactElement {
  const [resourceType, setResourceType] = useState(initialResource?.type ?? "folder");
  const [resourceId, setResourceId] = useState(initialResource?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [subjectKind, setSubjectKind] = useState("person");
  const [level, setLevel] = useState("view");
  const [revoke, setRevoke] = useState<string | null>(null);
  const list = useRead<CapMap["access.grants.list"]["out"]>("access.grants.list", resourceId.trim() ? { resource: { type: resourceType, id: resourceId.trim() } } : {});
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows: ReactElement[] = [];
  for (const grant of list.data.grants) rows.push(<Row key={grant.id} id={`console-grant-${grant.id}`} title={`${grant.subject.kind}: ${grant.subject.id}`} note={`${grant.level} · ${grant.resource.type}: ${grant.resource.id}`} trailing={<Button label="Revoke…" danger onPress={() => setRevoke(grant.id)} />} onPress={() => { setResourceType(grant.resource.type); setResourceId(grant.resource.id); }} />);
  return <View testID="console-grants"><Section title="Resource"><Group><Field label="Resource type" testID="grant-resource-type" value={resourceType} onChange={setResourceType} /><Field label="Resource id" testID="grant-resource-id" value={resourceId} onChange={setResourceId} /></Group></Section><Section title="Grants" count={rows.length}><Group>{rows.length ? rows : <Note>No grants match this resource.</Note>}</Group></Section><Section title="Give access"><Group><Field label="Subject kind (person, agent, group or role)" value={subjectKind} onChange={setSubjectKind} /><Field label="Subject id" testID="grant-subject-id" value={subjectId} onChange={setSubjectId} /><Field label="Level (view, use, edit or manage)" testID="grant-level" value={level} onChange={setLevel} /><Button label="Add grant" testID="grant-add" disabled={action.busy || !resourceId.trim() || !subjectId.trim() || !["view", "use", "edit", "manage"].includes(level) || !["person", "agent", "actor", "service", "group", "role"].includes(subjectKind)} onPress={() => void action.run("access.share", { resource: { type: resourceType, id: resourceId.trim() }, subject: { kind: subjectKind, id: subjectId.trim() }, level, idempotencyKey: attempt() }, "Access granted")} /></Group></Section>{revoke ? <Section title="Confirm revocation"><Note>This grant ends at once. Access through other grants may remain.</Note><Actions><Button label="Cancel" onPress={() => setRevoke(null)} /><Button label="Confirm revoke" testID="grant-revoke-confirm" danger disabled={action.busy} onPress={() => void action.run("access.unshare", { grantId: revoke }, "Grant revoked").then((out) => { if (out) setRevoke(null); })} /></Actions></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
