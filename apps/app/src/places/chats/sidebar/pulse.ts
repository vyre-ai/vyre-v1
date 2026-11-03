// What the Chats sidebar reads for the team (owner D21, D23, D24): the unseen While you were away digest, who is around (devices.presence) and which agents are at work (engine.now).
// Read when the sidebar opens, again on any change in the Space (a turn starting or ending, a digest written) at most every PULSE_QUIET_MS, and every PULSE_EVERY_MS while it stays
// open, because someone going quiet is not an event. An answer equal to the last draws nothing new, so the dots hold still.
import { useEffect, useRef, useState } from "react";
import { presenceMap, teamNow } from "../../../shell/team/now.ts";
import type { PresenceRow, TeamNow, WorkingRow } from "../../../shell/team/now.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export const PULSE_EVERY_MS = 30_000;
export const PULSE_QUIET_MS = 1_000;

export type DigestOut = CapMap["home.digest"]["out"];
export interface Pulse { digest: DigestOut["digest"]; team: TeamNow | null; presence: ReadonlyMap<string, "online" | "away"> }

const EMPTY: Pulse = { digest: null, team: null, presence: new Map() };

export interface PulseSource {
  call(cap: string, input: unknown): Promise<unknown>;
  changes?: { subscribe(listener: () => void): () => void } | undefined;
  personal: boolean;
  me?: string | undefined;
  personName(id: string): string;
  agentName(id: string): string;
}

/** One read of all three. A read that fails keeps what was there (a dot never flickers off because one poll missed). */
export async function readPulse(src: PulseSource, last: Pulse): Promise<Pulse> {
  const safe = <T,>(p: Promise<unknown>): Promise<T | null> => p.then((v) => v as T, () => null);
  const [d, p, w] = await Promise.all([
    safe<DigestOut>(src.call("home.digest", {})),
    src.personal ? Promise.resolve(null) : safe<{ people: PresenceRow[] }>(src.call("devices.presence", {})),
    src.personal ? Promise.resolve(null) : safe<{ working: WorkingRow[] }>(src.call("engine.now", {})),
  ]);
  const presence = p ? p.people : null;
  const team = src.personal ? null : teamNow({ presence: presence ?? undefined, working: w?.working, me: src.me, personName: src.personName, agentName: src.agentName });
  return {
    digest: d ? d.digest : last.digest,
    team: src.personal ? null : p || w ? team : last.team,
    presence: presence ? presenceMap(presence) : last.presence,
  };
}

const same = (a: Pulse, b: Pulse): boolean =>
  a.digest?.id === b.digest?.id && a.digest?.items.length === b.digest?.items.length && JSON.stringify(a.team) === JSON.stringify(b.team) && JSON.stringify([...a.presence]) === JSON.stringify([...b.presence]);

export function usePulse(src: PulseSource): { pulse: Pulse; reread(): void } {
  const [pulse, setPulse] = useState<Pulse>(EMPTY);
  const ref = useRef(src);
  ref.current = src;
  const last = useRef<Pulse>(EMPTY);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    void readPulse(ref.current, last.current).then((next) => {
      if (off || same(next, last.current)) return;
      last.current = next;
      setPulse(next);
    });
    return () => { off = true; };
  }, [tick, src.personal]);
  useEffect(() => {
    const every = setInterval(() => setTick((n) => n + 1), PULSE_EVERY_MS);
    let wait: ReturnType<typeof setTimeout> | null = null;
    const offChange = src.changes?.subscribe(() => { if (wait === null) wait = setTimeout(() => { wait = null; setTick((n) => n + 1); }, PULSE_QUIET_MS); });
    return () => { clearInterval(every); if (wait !== null) clearTimeout(wait); offChange?.(); };
  }, [src.changes]);
  return { pulse, reread: () => setTick((n) => n + 1) };
}
