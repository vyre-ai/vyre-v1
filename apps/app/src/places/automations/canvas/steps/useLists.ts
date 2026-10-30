// The lists the step forms pick from, loaded when a form opens and only then. Each is asked for through the place's own `call` as the signed-in person, so the Vault answers names and handles only and
// nothing shows that the person may not see. A list that fails to load is `unavailable` and the form says so; it never invents a choice.
import { useEffect, useState } from "react";
import { useOptionalAutomationsData } from "../data.tsx";
import { agentPicks, vaultPicks, whoPicks } from "./picks.ts";
import type { AgentPick, VaultPick, WhoPick } from "./picks.ts";

export type Load<T> = { state: "loading" } | { state: "ready"; items: T[] } | { state: "unavailable" };

function useLoaded<T>(load: (call: (cap: string, input: unknown) => Promise<unknown>) => Promise<T[]>): Load<T> {
  const data = useOptionalAutomationsData();
  const [value, setValue] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!data) { setValue({ state: "unavailable" }); return; }
    let live = true;
    load(data.call).then((items) => { if (live) setValue({ state: "ready", items }); }, () => { if (live) setValue({ state: "unavailable" }); });
    return () => { live = false; };
    // the lists are loaded once for a form that is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return value;
}

export const useVaultPicks = (): Load<VaultPick> => useLoaded(async (call) => vaultPicks(await call("vault.items.list", { limit: 200 })));
export const useAgentPicks = (): Load<AgentPick> => useLoaded(async (call) => agentPicks(await call("agents.list", {})));
export const useWhoPicks = (): Load<WhoPick> => useLoaded(async (call) => {
  const [people, groups] = await Promise.all([call("access.principals.list", { kind: "person", status: "active" }), call("access.groups.list", {}).catch(() => ({ groups: [] }))]);
  return whoPicks(people, groups);
});
