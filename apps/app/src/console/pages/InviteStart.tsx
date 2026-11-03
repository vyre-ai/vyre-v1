// Where an invited person starts (audit 3 Nov, owner D22): the invite sheet picks groups, channels, projects and agents. Everyone already starts in the Space's first channel (#vyre)
// and with what the Space shares with Everyone; those show ticked and fixed, so the admin sees the whole day one before sending. Pick rows, never a Select per row.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group } from "../shell/ui.tsx";
import { pickRow, useRead } from "./shared.tsx";

export interface StartSet { groups: string[]; channels: string[]; projects: string[]; agents: string[] }
export const EMPTY_START: StartSet = { groups: [], channels: [], projects: [], agents: [] };

type Groups = CapMap["access.groups.list"]["out"]["groups"];
type Channels = CapMap["channels.list"]["out"];
type Projects = CapMap["projects.list"]["out"];
type Agents = CapMap["agents.list"]["out"];
type Home = CapMap["channels.home"]["out"];
type Everyone = CapMap["access.groups.defaults_get"]["out"];

/** The invite input for a start set: only what was picked, and nothing the person gets anyway. */
export function startInput(s: StartSet): Partial<StartSet> {
  const out: Partial<StartSet> = {};
  for (const k of ["groups", "channels", "projects", "agents"] as const) if (s[k].length) out[k] = [...s[k]];
  return out;
}

const toggle = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function InviteStart({ value, onChange, groups }: { value: StartSet; onChange(next: StartSet): void; groups: Groups }): ReactElement {
  const channels = useRead<Channels>("channels.list", {});
  const home = useRead<Home>("channels.home", {});
  const projects = useRead<Projects>("projects.list", {});
  const agents = useRead<Agents>("agents.list", { section: "space" });
  const everyone = useRead<Everyone>("access.groups.defaults_get", {});
  const homeId = home.data?.channel?.channelId;
  const sharedAgents = useMemo(() => new Set((everyone.data?.grants ?? []).filter((g) => g.resource.type === "agent").map((g) => g.resource.id)), [everyone.data]);
  const pick = (k: keyof StartSet, id: string): void => onChange({ ...value, [k]: toggle(value[k], id) });

  const rows: ReactElement[] = [];
  const label = (text: string): void => { rows.push(<Text key={`h:${text}`} style={st.label}>{text}</Text>); };
  const plain = groups.filter((g) => g.id !== "grp_everyone");
  if (plain.length) {
    label("Groups");
    for (const g of plain) rows.push(<Row key={`g:${g.id}`} {...pickRow({ id: `invite-group-${g.id}`, title: g.name, picked: value.groups.includes(g.id), onPress: () => pick("groups", g.id) })} />);
  }
  label("Channels");
  if (home.data?.channel) rows.push(<Row key="c:home" {...pickRow({ id: "invite-channel-home", title: `#${home.data.channel.name}`, note: "Everyone starts here", picked: true, disabled: true, onPress: () => undefined })} />);
  for (const c of (channels.data?.channels ?? []).filter((x) => !x.archived && x.channelId !== homeId && x.recordId === undefined)) {
    rows.push(<Row key={`c:${c.channelId}`} {...pickRow({ id: `invite-channel-${c.channelId}`, title: `#${c.name}`, picked: value.channels.includes(c.channelId), onPress: () => pick("channels", c.channelId) })} />);
  }
  const ps = projects.data?.projects ?? [];
  if (ps.length) {
    label("Projects");
    for (const p of ps) rows.push(<Row key={`p:${p.projectId}`} {...pickRow({ id: `invite-project-${p.projectId}`, title: p.title, picked: value.projects.includes(p.projectId), onPress: () => pick("projects", p.projectId) })} />);
  }
  const as = (agents.data?.agents ?? []).filter((a) => a.kind !== "assistant");
  if (as.length) {
    label("Agents they can use");
    for (const a of as) {
      const shared = sharedAgents.has(a.agentId);
      rows.push(<Row key={`a:${a.agentId}`} {...pickRow({ id: `invite-agent-${a.agentId}`, title: a.name, ...(shared ? { note: "Shared with everyone" } : {}), picked: shared || value.agents.includes(a.agentId), disabled: shared, onPress: () => pick("agents", a.agentId) })} />);
    }
  }
  return <View testID="invite-start"><Text style={st.lead}>Where they start</Text><Group testID="invite-start-rows">{rows}</Group></View>;
}

const st = {
  lead: { fontSize: 13, fontWeight: "600" as const, color: "var(--ink)" as string, marginTop: 10, marginBottom: 4 },
  label: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
};
