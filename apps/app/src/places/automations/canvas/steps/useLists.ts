// The lists the step forms pick from, loaded when a form opens and only then. Each is asked for through the place's own `call` as the signed-in person, so the Vault answers names and handles only and
// nothing shows that the person may not see. A list that fails to load is `unavailable` and the form says so; it never invents a choice.
import { useEffect, useState } from "react";
import { useConnectVersion } from "../../../../shell/connect/context.ts";
import { useOptionalAutomationsData } from "../data.tsx";
import { agentPicks, refPicks, vaultPicks, whoPicks } from "./picks.ts";
import { rec, text } from "./picks.ts";
import type { AgentPick, RefPick, VaultPick, WhoPick } from "./picks.ts";

export type Load<T> = { state: "loading" } | { state: "ready"; items: T[] } | { state: "unavailable" };

function useLoaded<T>(load: (call: (cap: string, input: unknown) => Promise<unknown>) => Promise<T[]>): Load<T> {
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
  }, [data, connected]);
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

/** The things a field can hold the id of, by the id's prefix: which list to ask, and which row field is the id and which the name. Never shown as ids. */
export interface ThingKind {
  cap: string;
  input: Record<string, unknown>;
  key: string;
  ids: string[];
  names: string[];
  word: string;
}
export const THINGS: Record<string, ThingKind> = {
  chn: { cap: "channels.list", input: { limit: 200 }, key: "channels", ids: ["id", "channelId"], names: ["name", "title"], word: "channel" },
  mbx: { cap: "mail.mailbox.list", input: { limit: 200 }, key: "mailboxes", ids: ["id", "mailboxId"], names: ["address", "name"], word: "mailbox" },
  agt: { cap: "agents.list", input: {}, key: "agents", ids: ["agentId", "id"], names: ["name"], word: "agent" },
  aut: { cap: "automations.list", input: {}, key: "automations", ids: ["id"], names: ["name"], word: "automation" },
  jrn: { cap: "journeys.list", input: {}, key: "journeys", ids: ["id"], names: ["name"], word: "journey" },
  frm: { cap: "forms.list", input: { limit: 200 }, key: "forms", ids: ["formId", "id"], names: ["name", "title"], word: "form" },
};
export interface ThingPick {
  value: string;
  label: string;
}
export function thingPicks(kind: ThingKind, out: unknown): ThingPick[] {
  const rows = rec(out) && Array.isArray(out[kind.key]) ? (out[kind.key] as unknown[]) : [];
  const picks: ThingPick[] = [];
  for (const raw of rows) {
    if (!rec(raw)) continue;
    const value = kind.ids.map((k) => text(raw[k])).find((v) => v !== "") ?? "";
    const label = kind.names.map((k) => text(raw[k])).find((v) => v !== "") ?? "";
    if (value !== "" && label !== "") picks.push({ value, label });
  }
  return picks;
}
export const useThingPicks = (prefix: string): Load<ThingPick> =>
  useLoaded(async (call) => {
    const kind = THINGS[prefix];
    return kind ? thingPicks(kind, await call(kind.cap, kind.input)) : [];
  });
