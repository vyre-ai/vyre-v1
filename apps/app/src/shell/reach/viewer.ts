// The viewer reach judges by, built from what the shell already knows: who they are, their permission keys, and the Console pages console.nav lists for them (the Console's own check).
import { useEffect, useMemo, useState } from "react";
import { adminPages } from "../providers/settings-admin.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { MachinesOut } from "../../machines/model.ts";
import type { Item, Target, Viewer } from "./reach.ts";

const NO_PAGES: ReadonlySet<string> = new Set();

type Rt = Pick<ShellRuntime, "me" | "space" | "call" | "plainRole" | "permissions">;

/** The Console page ids this person may open. A Member or Guest and a Personal Space have no Console, so nothing is asked of the server. Null until the answer comes. */
export function useConsolePages(rt: Rt | null): ReadonlySet<string> | null {
  const none = rt === null || rt.space.kind === "personal" || rt.plainRole === true;
  const [pages, setPages] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (none || rt === null) return undefined;
    let live = true;
    void rt.call("console.nav", {}).then((out) => { if (live) setPages(adminPages(out as Parameters<typeof adminPages>[0])); }, () => { if (live) setPages(NO_PAGES); });
    return () => { live = false; };
  }, [rt, none]);
  return none ? NO_PAGES : pages;
}

export function useViewer(rt: Rt | null): Viewer | null {
  const pages = useConsolePages(rt);
  return useMemo(() => (rt === null || pages === null ? null : { id: rt.me.id, spaceId: rt.space.id, ...(rt.permissions ? { perms: rt.permissions } : {}), consolePages: pages }), [rt, pages]);
}

/** A reach target as the shell opens it: a Console or Settings screen by id and arguments, anything else by its place hash. */
export function shellTarget(t: Target): { screen?: string; args?: Record<string, unknown> } {
  return t.screen !== undefined ? { screen: t.screen, ...(t.args ? { args: t.args } : {}) } : {};
}

/** The machine a computer runs on, as reach judges it: its row in machines.list, the agents pinned to it and this one, and what needs an admin (an alert on it). Null when the list does not show it. */
export function machineItem(out: MachinesOut, serverId: string, nameOf: (id: string) => string, agentName?: string): Item | null {
  const m = out.machines.find((x) => x.serverId === serverId);
  if (m === undefined) return null;
  const alert = out.alerts.find((a) => a.serverId === serverId);
  const agents = [...new Set([...(agentName ? [agentName] : []), ...m.pins.map(nameOf)])];
  return {
    kind: "machine", id: m.serverId, name: m.nickname ?? m.name, online: m.online, machineKind: m.kind, ...(m.owner ? { owner: m.owner, ownerName: nameOf(m.owner) } : {}), agents,
    ...(alert ? { needs: alert.title } : !m.online ? { needs: "Offline" } : {}),
  };
}
