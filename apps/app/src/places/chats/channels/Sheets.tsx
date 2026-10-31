// The two channel sheets as the Chats sidebar mounts them: loads who can be picked (people, agents, projects) and wires create and join to the Space.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useSidebarData } from "../sidebar/data.tsx";
import type { Agent, Channel } from "../sidebar/model.ts";
import { BrowseChannels } from "./BrowseChannels.tsx";
import { NewChannelSheet } from "./NewChannelSheet.tsx";
import { joinable, pickEntries, takenNames } from "./model.ts";
import type { PrincipalRow, ProjectRow } from "./model.ts";
import type { ChannelSheetKind } from "./request.ts";

export function ChannelSheets({ kind, channels, agents, onSwitch, onClose }: { kind: ChannelSheetKind; channels: readonly Channel[]; agents: readonly Agent[]; onSwitch(k: ChannelSheetKind): void; onClose(): void }): ReactElement {
  const data = useSidebarData();
  const meId = data.me?.id ?? "";
  const [principals, setPrincipals] = useState<PrincipalRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  useEffect(() => {
    if (kind !== "new") return undefined;
    let off = false;
    void Promise.resolve().then(() => data.call("access.principals.list", { kind: "person", status: "active" })).then((r) => { if (!off) setPrincipals((r as CapMap["access.principals.list"]["out"]).principals); }, () => undefined);
    void Promise.resolve().then(() => data.call("projects.list", {})).then((r) => { if (!off) setProjects((r as CapMap["projects.list"]["out"]).projects); }, () => undefined);
    return () => { off = true; };
  }, [data.call, kind]);
  const picks = useMemo(() => pickEntries(principals, agents, meId, data.space.assistant.agentId), [principals, agents, meId, data.space.assistant.agentId]);
  const taken = useMemo(() => takenNames(channels), [channels]);
  const open = (id: string): void => { onClose(); data.nav.openChannel(id); };
  if (kind === "browse") {
    return <BrowseChannels channels={joinable(channels, meId)} join={async (channelId) => { await data.call("channels.join", { channelId }); }} onJoined={open} onClose={onClose} onNew={() => onSwitch("new")} />;
  }
  return (
    <NewChannelSheet
      people={picks.people} agents={picks.agents} projects={projects} taken={taken} onClose={onClose} onCreated={open}
      create={async (input) => (await data.call("channels.create", input) as CapMap["channels.create"]["out"]).channel.channelId}
    />
  );
}
