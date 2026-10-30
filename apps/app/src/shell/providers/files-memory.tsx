// The Knowledge screens of Files over the Space's runtime (spec 2.15, 3.5): Learned, People, Clients, Projects, Topics, a living page, the Graph, History, Trash, Archive and Search.
// The agents come from agents.list, so the graph opens on the first agent the person can see; a fact's source and a note with a link open through the shell.
import { useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { KnowRouter, MemoryDataProvider } from "../../places/files/memory/index.ts";
import type { KnowRoute } from "../../places/files/memory/index.ts";
import type { AgentRef, MemoryData } from "../../places/files/memory/index.ts";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

interface AgentsOut { agents: ReadonlyArray<{ agentId: string; name: string }> }

export function memoryData(rt: ShellRuntime, agents: readonly AgentRef[], go: (route: KnowRoute) => void = () => undefined): MemoryData {
  return {
    live: (cap, input) => capLive(rt, cap, input as Record<string, unknown>),
    call: rt.call,
    now: () => rt.clock().now,
    agents,
    nameOf: nameLookup(rt),
    me: rt.me,
    nav: {
      // a note opens in the graph's side pane; one with a link to a chat, task or record opens that place
      openNote: (_nodeId, link) => { if (link) rt.openUrl(link); },
      openSource: (link) => rt.openUrl(link),
      go,
      openChat: (link) => rt.openUrl(link),
    },
  };
}

export function MemoryMount({ rt, route, go }: { rt: ShellRuntime; route: KnowRoute; go: (route: KnowRoute) => void }): ReactElement {
  const q = useMemo(() => capLive<AgentsOut>(rt, "agents.list", {}), [rt]);
  const s = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const agents = useMemo<readonly AgentRef[]>(() => (s.status === "ready" ? s.data.agents.map((a) => ({ id: a.agentId, name: a.name })) : []), [s]);
  const data = useMemo(() => memoryData(rt, agents, go), [rt, agents, go]);
  return <MemoryDataProvider value={data}><KnowRouter route={route} /></MemoryDataProvider>;
}
