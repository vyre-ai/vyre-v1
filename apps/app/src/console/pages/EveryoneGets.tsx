// Console > People > What everyone gets (owner D22, 3 Nov): what a new member has on day one, which is what the Space shares with Everyone. The first channel (#vyre), the agents,
// record types, Space folders, Space skills and Shared Vault items everyone may use. Admins add and remove agents and Vault items here (a grant to the Everyone group, which every
// member is in from the moment they join); the other kinds already have an "everyone" of their own, and this page names it and where it changes. Mine items and restricted items are
// never shared with everyone: the server refuses them.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { useObjectNames } from "../objects/names.ts";
import { useConsoleData } from "../shell/data.tsx";
import { Group, LinkButton, Section } from "../shell/ui.tsx";
import { Note, useAction, useRead } from "./shared.tsx";

export const EVERYONE = { kind: "group", id: "grp_everyone" } as const;
type Grants = CapMap["access.groups.defaults_get"]["out"];
type Home = CapMap["channels.home"]["out"];
type Agents = CapMap["agents.list"]["out"];
type Vault = CapMap["vault.items.list"]["out"];
type Skills = CapMap["skills.list"]["out"];
type Types = CapMap["schema.types.list"]["out"];
type Files = CapMap["files.list"]["out"];

/** What everyone has, by kind, from the Everyone group's grants: the agent and Vault ids a new member can use. */
export function everyoneByKind(grants: Grants["grants"] | undefined): { agents: string[]; vault: { type: "vault_item" | "vault_folder"; id: string }[]; files: { type: string; id: string }[]; records: { type: string; id: string }[] } {
  const out = { agents: [] as string[], vault: [] as { type: "vault_item" | "vault_folder"; id: string }[], files: [] as { type: string; id: string }[], records: [] as { type: string; id: string }[] };
  for (const g of grants ?? []) {
    const r = g.resource;
    if (r.type === "agent") out.agents.push(r.id);
    else if (r.type === "vault_item" || r.type === "vault_folder") out.vault.push({ type: r.type, id: r.id });
    else if (r.type === "file" || r.type === "folder") out.files.push(r);
    else if (r.type === "record" || r.type === "record_type") out.records.push(r);
  }
  return out;
}

export function EveryoneGets(): ReactElement {
  const data = useConsoleData();
  const menu = useMenu();
  const grants = useRead<Grants>("access.groups.defaults_get", {});
  const home = useRead<Home>("channels.home", {});
  const agents = useRead<Agents>("agents.list", {});
  const vault = useRead<Vault>("vault.items.list", { section: "shared" });
  const skills = useRead<Skills>("skills.list", {});
  const types = useRead<Types>("schema.types.list", { section: "space" });
  const folders = useRead<Files>("files.list", { section: "space" });
  const refresh = (): void => { grants.refresh(); vault.refresh(); };
  const act = useAction(refresh);
  const [open, setOpen] = useState(false);
  const by = everyoneByKind(grants.data?.grants);
  const names = useObjectNames({ identities: [], resources: [...by.files, ...by.records] });
  const agentName = (id: string): string => agents.data?.agents.find((a) => a.agentId === id)?.name ?? data.name(id);
  const vaultName = (id: string): string => vault.data?.items.find((i) => i.id === id)?.name ?? "A Vault item";
  const share = (resource: { type: string; id: string }, name: string): void => {
    if (resource.type === "agent") void act.run("access.share", { resource, subject: EVERYONE, level: "use", idempotencyKey: `everyone:${resource.id}` }, `${name} is shared with everyone. New members can use it from day one.`);
    else void act.run("vault.share", { resource, subject: EVERYONE, level: "use", idempotencyKey: `everyone:${resource.id}` }, `${name} is shared with everyone. Agents use it by name; nobody sees its value.`);
  };
  const unshare = (resource: { type: string; id: string }, name: string): void => {
    if (resource.type === "vault_item" || resource.type === "vault_folder") void act.run("vault.unshare", { resource, subject: EVERYONE }, `${name} is no longer shared with everyone.`);
    else void act.run("access.unshare", { resource, subject: EVERYONE }, `${name} is no longer shared with everyone.`);
  };
  const addMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [];
    const freeAgents = (agents.data?.agents ?? []).filter((a) => a.kind !== "assistant" && !by.agents.includes(a.agentId));
    if (freeAgents.length) { items.push({ head: "Agents" }); for (const a of freeAgents) items.push({ label: a.name, onSelect: () => share({ type: "agent", id: a.agentId }, a.name) }); }
    const freeVault = (vault.data?.items ?? []).filter((i) => i.scope === "shared" && !by.vault.some((v) => v.id === i.id));
    if (freeVault.length) { if (items.length) items.push({ separator: true }); items.push({ head: "Shared Vault items" }); for (const i of freeVault) items.push({ label: i.name, onSelect: () => share({ type: "vault_item", id: i.id }, i.name) }); }
    if (!items.length) items.push({ head: "Every agent and Shared Vault item is shared with everyone already" });
    menu.show(items, x, y, "other", { label: "Share with everyone" });
  };

  const rows: ReactElement[] = [];
  const label = (text: string): void => { rows.push(<Text key={`h:${text}`} style={st.label}>{text}</Text>); };
  label("The first channel");
  const ch = home.data?.channel;
  rows.push(<Row key="home" id="everyone-home" title={ch ? `#${ch.name}` : "#vyre"} note={ch?.legacy ? "Every new member joins it. New Spaces call it #vyre: Overview offers the rename." : "Every new member joins it"} />);
  label("Agents");
  if (by.agents.length === 0) rows.push(<Row key="a:none" id="everyone-agents-none" title="No agent yet" note="Share one so new members have someone to ask on day one" />);
  for (const id of by.agents) rows.push(<Row key={`a:${id}`} id={`everyone-agent-${id}`} title={agentName(id)} note="Use" trailing={<LinkButton label="Remove" testID={`everyone-remove-${id}`} onPress={() => unshare({ type: "agent", id }, agentName(id))} />} />);
  label("Shared Vault items");
  if (by.vault.length === 0) rows.push(<Row key="v:none" id="everyone-vault-none" title="None" note="Only Shared items can be shared with everyone; Mine items stay private" />);
  for (const v of by.vault) rows.push(<Row key={`v:${v.id}`} id={`everyone-vault-${v.id}`} title={vaultName(v.id)} note="Use, by name" trailing={<LinkButton label="Remove" testID={`everyone-remove-${v.id}`} onPress={() => unshare(v, vaultName(v.id))} />} />);
  label("Records");
  const ts = types.data?.types ?? [];
  if (ts.length === 0 && by.records.length === 0) rows.push(<Row key="r:none" id="everyone-records-none" title="No record type yet" />);
  for (const t of ts.slice(0, open ? ts.length : 5)) rows.push(<Row key={`t:${t.key}`} id={`everyone-type-${t.key}`} title={t.plural} note="Open to everyone, as their role allows. Set apart from its Share sheet in Records" />);
  for (const r of by.records) rows.push(<Row key={`r:${r.id}`} id={`everyone-record-${r.id}`} title={names.resource(r)} note="Shared with everyone" trailing={<LinkButton label="Remove" onPress={() => unshare(r, names.resource(r))} />} />);
  label("Files");
  const fs = folders.data?.folders ?? [];
  for (const f of fs.slice(0, open ? fs.length : 5)) rows.push(<Row key={`f:${f.folderId}`} id={`everyone-folder-${f.folderId}`} title={f.name} note="Space folder: everyone sees it" />);
  for (const f of by.files) rows.push(<Row key={`g:${f.id}`} id={`everyone-file-${f.id}`} title={names.resource(f)} note="Shared with everyone" trailing={<LinkButton label="Remove" onPress={() => unshare(f, names.resource(f))} />} />);
  if (fs.length === 0 && by.files.length === 0) rows.push(<Row key="f:none" id="everyone-files-none" title="No Space folder yet" note="Make one in Files, or share a folder with Everyone" />);
  label("Skills");
  const sk = (skills.data?.skills ?? []).filter((x) => x.tier === "space" && x.enabled);
  if (sk.length === 0) rows.push(<Row key="s:none" id="everyone-skills-none" title="No Space skill yet" note="Skills added to the Space library reach every member's agents" />);
  for (const x of sk.slice(0, open ? sk.length : 5)) rows.push(<Row key={`s:${x.name}`} id={`everyone-skill-${x.name}`} title={x.name} note="Space library" />);
  const long = ts.length > 5 || fs.length > 5 || sk.length > 5;
  return (
    <View testID="everyone-gets">
      <Section title="What everyone gets" right={<LinkButton label="Share with everyone" testID="everyone-add" onPress={() => addMenu(20, 120)} />}>
        <Group testID="everyone-rows">{rows}</Group>
        {long ? <LinkButton label={open ? "Show fewer" : "Show all"} onPress={() => setOpen(!open)} /> : null}
        <Note>New members get all of this the moment they join. Private and restricted items, and anyone's Mine items, are never in it.</Note>
        {act.note ? <Note>{act.note}</Note> : null}
      </Section>
      {menu.element}
    </View>
  );
}

const st = { label: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 } };
