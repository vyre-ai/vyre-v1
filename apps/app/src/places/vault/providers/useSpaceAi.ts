// The Space AI accounts a picker lists, loaded once from providers.list as the person (the same rows the Vault's Space tab shows).
import { useEffect, useRef, useState } from "react";
import type { PickRow } from "./pick.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** null while loading; an empty list when none, or when providers.list did not answer. */
export function useSpaceAi(call: Call): readonly PickRow[] | null {
  const [rows, setRows] = useState<readonly PickRow[] | null>(null);
  // read once: a caller that makes a new function each render must not fetch again each render
  const latest = useRef(call);
  latest.current = call;
  useEffect(() => {
    let live = true;
    void new Promise<unknown>((resolve) => resolve(latest.current("providers.list", {}))).then(
      (o) => { if (live) setRows(((o as { providers?: PickRow[] } | null)?.providers ?? []).map((p) => ({ id: p.id, name: p.name, scope: p.scope, ...(p.handle ? { handle: p.handle } : {}), ...(p.state ? { state: p.state } : {}), ...(p.spaceKey ? { spaceKey: true } : {}), ...(p.uses ? { uses: p.uses } : {}), ...(p.capCents !== undefined ? { capCents: p.capCents } : {}), ...(p.capped ? { capped: true } : {}) }))); },
      () => { if (live) setRows([]); },
    );
    return () => { live = false; };
  }, []);
  return rows;
}
