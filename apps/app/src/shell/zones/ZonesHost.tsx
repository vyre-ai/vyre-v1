// The Space's time zone and the person's own, for every place under it (ui/Time reads them). The Space's comes from spaces.get, the person's from profile.timezone; a person who never set one reads
// in this computer's zone. `refreshZones()` is called by the Console and Settings rows after a save, so a change shows at once; a returning window reads again on its own.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { deviceZone, validZone } from "../../../../../lib/zones.ts";
import { ZonesProvider } from "../../../../../ui/src/Time/index.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";

const listeners = new Set<() => void>();
/** Read the zones again (after a save of the Space's or the person's own). */
export function refreshZones(): void { for (const l of listeners) l(); }

/** The zones from the two reads. A Space that has none yet, or a zone nobody's runtime knows, reads in this computer's zone. */
export function zonesFrom(space: string | undefined, person: { value: unknown; source: string } | undefined, device: string): { space: string; viewer: string } {
  const own = person && person.source !== "default" && validZone(person.value) ? person.value : device;
  return { space: validZone(space) ? space : own, viewer: own };
}

export function ZonesHost({ rt, children }: { rt: ShellRuntime; children: ReactNode }): ReactElement {
  const [state, setState] = useState<{ space?: string; person?: { value: unknown; source: string } }>({});
  const load = useCallback((): void => {
    void Promise.all([
      Promise.resolve(rt.call("spaces.get", {})).then((o) => (o as CapMap["spaces.get"]["out"]).space.timezone, () => undefined),
      Promise.resolve(rt.call("settings.get", { key: "profile.timezone" })).then((o) => (o as CapMap["settings.get"]["out"]).row, () => undefined),
    ]).then(([space, row]) => setState((cur) => (cur.space === space && cur.person?.value === row?.value && cur.person?.source === row?.source ? cur : { ...(space ? { space } : {}), ...(row ? { person: { value: row.value, source: row.source } } : {}) })));
  }, [rt]);
  useEffect(() => {
    load();
    listeners.add(load);
    const doc = (globalThis as { document?: { addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void; visibilityState?: string } }).document;
    const back = (): void => { if (doc?.visibilityState !== "hidden") load(); };
    doc?.addEventListener("visibilitychange", back);
    return () => { listeners.delete(load); doc?.removeEventListener("visibilitychange", back); };
  }, [load]);
  const device = useMemo(() => deviceZone(), []);
  const zones = useMemo(() => zonesFrom(state.space, state.person, device), [state, device]);
  return <ZonesProvider value={zones}>{children as ReactElement}</ZonesProvider>;
}
