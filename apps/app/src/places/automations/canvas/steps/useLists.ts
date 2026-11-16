// The lists the step forms pick from, loaded when a form opens and only then. Each is asked for through the place's own `call` as the signed-in person, so the Vault answers names and handles only and
// nothing shows that the person may not see. A list that fails to load is `unavailable` and the form says so; it never invents a choice.
import { useEffect, useState } from "react";
import { useConnectVersion } from "../../../../shell/connect/context.ts";
import { useOptionalAutomationsData } from "../data.tsx";
import { agentPicks, refPicks, vaultPicks, whoPicks } from "./picks.ts";
import { THINGS, thingInput, thingPicks, rec, text } from "./picks.ts";
import type { ThingKind, ThingPick } from "./picks.ts";
export { THINGS, thingInput, thingPicks };
export type { ThingKind, ThingPick };
import type { AgentPick, RefPick, VaultPick, WhoPick } from "./picks.ts";

export type Load<T> = { state: "loading" } | { state: "ready"; items: T[] } | { state: "unavailable" };

function useLoaded<T>(
  load: (call: (cap: string, input: unknown) => Promise<unknown>) => Promise<T[]>,
  again = "",
): Load<T> {
  const data = useOptionalAutomationsData();
  const connected = useConnectVersion();
  const [value, setValue] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!data) {
      setValue({ state: "unavailable" });
      return;
    }
    let live = true;
    load(data.call).then(
      (items) => {
        if (live) setValue({ state: "ready", items });
      },
      () => {
        if (live) setValue({ state: "unavailable" });
      },
    );
    return () => {
      live = false;
    };
    // the lists are loaded once for a form that is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, connected, again]);
  return value;
}

export const useVaultPicks = (): Load<VaultPick> =>
  useLoaded(async (call) => vaultPicks(await call("vault.items.list", { limit: 200 })));
export const useAgentPicks = (): Load<AgentPick> =>
  useLoaded(async (call) => agentPicks(await call("agents.list", {})));
export const useWhoPicks = (): Load<WhoPick> =>
  useLoaded(async (call) => {
    const [people, groups] = await Promise.all([
      call("access.principals.list", { kind: "person", status: "active" }),
      call("access.groups.list", {}).catch(() => ({ groups: [] })),
    ]);
    return whoPicks(people, groups);
  });

const REF_CAP = { types: "schema.types.list", forms: "forms.list", journeys: "journeys.list" } as const;
/** The record types, forms or Journeys a trigger can be narrowed to. */
export const useRefPicks = (kind: "types" | "forms" | "journeys"): Load<RefPick> =>
  useLoaded(async (call) => refPicks(kind, await call(REF_CAP[kind], {})));

export const useThingPicks = (prefix: string, step: Record<string, unknown> = {}): Load<ThingPick> => {
  const kind = THINGS[prefix];
  const ask = kind ? thingInput(kind, step) : null;
  const key = JSON.stringify(ask);
  return useLoaded(async (call) => (kind && ask ? thingPicks(kind, await call(kind.cap, ask)) : []), key);
};

/** The Space's event catalogue (events.types): what a Wait can wait for. */
export const useEventTypes = (): Load<{ name: string; summary: string; payload?: unknown }> =>
  useLoaded(async (call) => {
    const out = await call("events.types", {});
    const rows = rec(out) && Array.isArray(out["types"]) ? (out["types"] as unknown[]) : [];
    return rows.flatMap((r) =>
      rec(r) && text(r["name"]) !== ""
        ? [
            {
              name: text(r["name"]),
              summary: text(r["summary"]),
              ...(r["payload"] !== undefined ? { payload: r["payload"] } : {}),
            },
          ]
        : [],
    );
  });
