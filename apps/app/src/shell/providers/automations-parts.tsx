// What the Automations place mounts beyond the canvas: the config directory (who can be picked), the runs data, run history on an automation, Failed runs, a run in Main or the side,
// and the Journey designer with its pane and the new Journey sheet. All of it reads the Space's runtime; nothing here invents a row.
import { ResizableColumn } from "../../../../../ui/src/SidePane/resize.tsx";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { ConfigDirectory, ConfigExtras, DirEntry } from "../../places/automations/config/data.tsx";
import { EMPTY_DIRECTORY } from "../../places/automations/config/data.tsx";
import { useScreenQuery, CANVAS } from "../../places/automations/canvas/data.tsx";
import type { AutomationsNav } from "../../places/automations/canvas/data.tsx";
import { JourneyDesigner, JourneyNewSheet, JourneyPane } from "../../places/automations/journeys/index.ts";
import type { Selection } from "../../places/automations/journeys/index.ts";
import { FailedRuns, RunChat, RunHistory } from "../../places/automations/runs/index.ts";
import type { RunsData } from "../../places/automations/runs/index.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { nameOf } from "./misc-common.ts";

const rows = (out: unknown, key: string): Record<string, unknown>[] => {
  const list = out && typeof out === "object" ? (out as Record<string, unknown>)[key] : null;
  return Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};
const entries = (list: Record<string, unknown>[], id: string, name: string): DirEntry[] =>
  list.flatMap((r) => (typeof r[id] === "string" && typeof r[name] === "string" ? [{ id: r[id] as string, name: r[name] as string }] : []));

/** The people, groups, roles, agents, channels and Automations a picker can offer, read from the Space. A list that cannot be read stays empty. */
export function directoryFrom(parts: { people: readonly DirEntry[]; agents: readonly DirEntry[]; groups: unknown; roles: unknown; channels: unknown; automations: unknown }): ConfigDirectory {
  const autos = rows(parts.automations, "automations");
  const using = (trigger: string): DirEntry[] => entries(autos.filter((a) => Array.isArray(a["triggers"]) && (a["triggers"] as unknown[]).includes(trigger)), "id", "name");
  return {
    people: parts.people, agents: parts.agents,
    groups: entries(rows(parts.groups, "groups"), "id", "name"),
    roles: entries(rows(parts.roles, "roles"), "id", "name"),
    channels: entries(rows(parts.channels, "channels").filter((c) => c["archived"] !== true), "channelId", "name"),
    automations: using("journey_stage_entered"),
    automationsLeaving: using("journey_stage_left"),
  };
}

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };

export function useDirectory(rt: ShellRuntime): ConfigDirectory {
  const people = useSyncExternalStore(rt.principals?.subscribe ?? NEVER.subscribe, rt.principals?.getSnapshot ?? NEVER.getSnapshot, rt.principals?.getSnapshot ?? NEVER.getSnapshot) as QueryState<{ id: string; name: string; kind: string }[]>;
  const [loaded, setLoaded] = useState<{ groups: unknown; roles: unknown; channels: unknown; automations: unknown }>({ groups: null, roles: null, channels: null, automations: null });
  useEffect(() => {
    let live = true;
    const read = (cap: string, input: unknown): Promise<unknown> => rt.call(cap, input).catch(() => null);
    void Promise.all([read("access.groups.list", {}), read("access.roles.list", {}), read("channels.list", {}), read("automations.list", { limit: 200 })])
      .then(([groups, roles, channels, automations]) => { if (live) setLoaded({ groups, roles, channels, automations }); });
    return () => { live = false; };
  }, [rt]);
  const list = people.status === "ready" ? people.data : [];
  return useMemo(() => directoryFrom({
    people: list.filter((p) => p.kind === "person").map((p) => ({ id: p.id, name: p.name })),
    agents: list.filter((p) => p.kind === "agent").map((p) => ({ id: p.id, name: p.name })),
    ...loaded,
  }), [list, loaded]);
}

export function configExtras(directory: ConfigDirectory, nav: Pick<AutomationsNav, "openAutomation"> & { openRuns(id: string): void; openRecords?(recordType: string, stage?: string): void }): ConfigExtras {
  return {
    directory,
    ...(nav.openRecords ? { openRecords: nav.openRecords } : {}),
    openAutomation: nav.openAutomation,
    openRuns: nav.openRuns,
  };
}

export function runsData(rt: ShellRuntime, nav: { openAutomation(id: string, stepId?: string): void; openRun(id: string): void; openRunSide(id: string): void; ask(id: string, ctx?: Record<string, unknown>): void }): RunsData {
  return {
    screens: rt.screens,
    thread: (threadId) => rt.screens.query("chats.conversation", "messages", { threadId }) as unknown as ReturnType<RunsData["thread"]>,
    call: rt.call, me: { id: rt.me.id, name: rt.me.name }, name: nameOf(rt), nav, clock: () => ({ now: rt.clock().now }),
  };
}

type GetOut = { automation?: { version?: number } };

/** The Runs tab of an automation: its run history, newest first, with the menu on every row. */
export function AutomationRuns({ automationId, selectedRunId }: { automationId: string; selectedRunId: string | null }): ReactElement {
  const q = useScreenQuery<GetOut>(CANVAS, "automation", { automationId, route: { automationId } });
  const version = q.status === "ready" ? q.data.automation?.version : undefined;
  return <RunHistory subject={{ type: "automation", id: automationId }} {...(version !== undefined ? { currentVersion: version } : {})} selectedRunId={selectedRunId} />;
}

export function FailedView({ selectedRunId }: { selectedRunId: string | null }): ReactElement {
  return <FailedRuns scope="mine" selectedRunId={selectedRunId} />;
}

export function RunView({ runId }: { runId: string }): ReactElement {
  return <RunChat runId={runId} wide />;
}

/** The Journey designer with the pane of the stage or task chosen in it. */
export function JourneyView({ journeyId }: { journeyId: string }): ReactElement {
  const [selection, setSelection] = useState<Selection | null>(null);
  return (
    <View testID="journey-view" style={j.row}>
      <View style={j.main}><JourneyDesigner key={journeyId} journeyId={journeyId} selection={selection} onSelect={setSelection} /></View>
      {selection ? <ResizableColumn paneKey="journey-pane" defaultWidth={360} grow="left" min={280} style={j.pane as never}><JourneyPane journeyId={journeyId} selection={selection} /></ResizableColumn> : null}
    </View>
  );
}

export function JourneyNewView({ onClose }: { onClose(): void }): ReactElement {
  return <View style={j.sheet}><JourneyNewSheet onClose={onClose} /></View>;
}

const j = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minWidth: 0 },
  main: { flex: 1, minWidth: 0 },
  pane: { width: 360, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  sheet: { flex: 1, padding: 24, alignItems: "flex-start" },
});
