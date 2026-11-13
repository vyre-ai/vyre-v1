// Does the relay carry web request triggers to this box? Asked of the relay itself (its /__vyre/info.json says `hooks: true` once the worker that passes POST /hooks/automation/... is deployed), not
// read from this box's code version, so a web request trigger's card shows the vyre.run address only when an outside app can really reach it. The answer is cached: 10 minutes when known, 1 minute after
// a failed ask. Until the first answer the card says nothing can reach it yet, which is the truth until proven otherwise.
import type { FetchFn } from "../platform/probes.ts";

export function createRelayHooksCheck(
  fetchFn: FetchFn | null,
  now: () => number = Date.now,
): (origin: string) => boolean {
  const known = new Map<string, { carries: boolean; until: number }>();
  const asking = new Set<string>();
  const ask = (origin: string): void => {
    if (!fetchFn || asking.has(origin)) return;
    asking.add(origin);
    void (async () => {
      let carries = false;
      let ok = false;
      try {
        const r = await fetchFn(`${origin.replace(/\/+$/, "")}/__vyre/info.json`, {
          method: "GET",
          signal: AbortSignal.timeout(5_000),
        });
        if (r.ok) {
          const j = JSON.parse(await r.text()) as { hooks?: unknown };
          carries = j.hooks === true;
          ok = true;
        }
      } catch {
        /* not known: asked again in a minute */
      }
      known.set(origin, { carries, until: now() + (ok ? 600_000 : 60_000) });
      asking.delete(origin);
    })();
  };
  return (origin) => {
    const k = known.get(origin);
    if (!k || k.until <= now()) ask(origin);
    return k?.carries === true;
  };
}
