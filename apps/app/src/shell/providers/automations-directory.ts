// The config directory (who can be picked in a People, Agents, Channels or Automations picker), read from the Space. In a file of its own so the Chats place, which only needs the directory, does not
// carry the Automations screens that automations-parts.tsx mounts (r39: they were a megabyte of the first signed-in download).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { ConfigDirectory, DirEntry } from "../../places/automations/config/data.tsx";
import { EMPTY_DIRECTORY } from "../../places/automations/config/data.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const rows = (out: unknown, key: string): Record<string, unknown>[] => {
  const list = out && typeof out === "object" ? (out as Record<string, unknown>)[key] : null;
  return Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};
const entries = (list: Record<string, unknown>[], id: string, name: string): DirEntry[] =>
  list.flatMap((r) =>
    typeof r[id] === "string" && typeof r[name] === "string" ? [{ id: r[id] as string, name: r[name] as string }] : [],
  );

/** The people, groups, roles, agents, channels and Automations a picker can offer, read from the Space. A list that cannot be read stays empty. */
export function directoryFrom(parts: {
  people: readonly DirEntry[];
  agents: readonly DirEntry[];
  groups: unknown;
  roles: unknown;
  channels: unknown;
  automations: unknown;
}): ConfigDirectory {
  const autos = rows(parts.automations, "automations");
  const using = (trigger: string): DirEntry[] =>
    entries(
      autos.filter((a) => Array.isArray(a["triggers"]) && (a["triggers"] as unknown[]).includes(trigger)),
      "id",
      "name",
    );
  return {
    people: parts.people,
    agents: parts.agents,
    groups: entries(rows(parts.groups, "groups"), "id", "name"),
    roles: entries(rows(parts.roles, "roles"), "id", "name"),
    channels: entries(
      rows(parts.channels, "channels").filter((c) => c["archived"] !== true),
      "channelId",
      "name",
    ),
    automations: using("journey_stage_entered"),
    automationsLeaving: using("journey_stage_left"),
  };
}

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };

export function useDirectory(rt: ShellRuntime): ConfigDirectory {
  const people = useSyncExternalStore(
    rt.principals?.subscribe ?? NEVER.subscribe,
    rt.principals?.getSnapshot ?? NEVER.getSnapshot,
    rt.principals?.getSnapshot ?? NEVER.getSnapshot,
  ) as QueryState<{ id: string; name: string; kind: string }[]>;
  const [settled, setSettled] = useState(false);
  const [loaded, setLoaded] = useState<{ groups: unknown; roles: unknown; channels: unknown; automations: unknown }>({
    groups: null,
    roles: null,
    channels: null,
    automations: null,
  });
  useEffect(() => {
    let live = true;
    const read = (cap: string, input: unknown): Promise<unknown> => rt.call(cap, input).catch(() => null);
    void Promise.all([
      read("access.groups.list", {}),
      read("access.roles.list", {}),
      read("channels.list", {}),
      read("automations.list", { limit: 200 }),
    ]).then(([groups, roles, channels, automations]) => {
      if (live) {
        setLoaded({ groups, roles, channels, automations });
        setSettled(true);
      }
    });
    return () => {
      live = false;
    };
  }, [rt]);
  const list = people.status === "ready" ? people.data : [];
  const loading = people.status !== "ready" || !settled;
  return useMemo(
    () => ({
      ...directoryFrom({
        people: list.filter((p) => p.kind === "person").map((p) => ({ id: p.id, name: p.name })),
        agents: list
          .filter((p) => p.kind === "agent" && (p as { private?: boolean }).private !== true)
          .map((p) => ({ id: p.id, name: p.name })),
        ...loaded,
      }),
      ...(loading ? { loading: true } : {}),
    }),
    [list, loaded, loading],
  );
}
