import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { useConsoleData } from "../shell/data.tsx";

type Roles = CapMap["access.roles.list"]["out"];
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
export {People} from "./People.tsx";
