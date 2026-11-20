// What the board knows about its stages: from the Journey that owns the type (time limit, finish line, the fields a stage needs) and from the saved view (WIP limits). Read once, refreshed
// every half minute and after a move, so a header's "1 late" is never older than that.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Call } from "../journey/model.ts";
import type { ViewRow } from "../sidebar/model.ts";
import type { Lane } from "../views-a/model.ts";
import type { StageInfo } from "./stats.ts";

export interface BoardStages {
  by: Readonly<Record<string, StageInfo>>;
  /** The late cards per stage as the server counts them (the whole column, not the cards loaded). */
  late: Readonly<Record<string, number>>;
  refresh(): void;
}

/** The WIP limits a view keeps: a stage key and a count above zero. Anything else in the config is passed over. */
export function wipOf(saved: Pick<ViewRow, "config"> | undefined): Record<string, number> {
  const raw = saved?.config?.["wip"];
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === "number" && Number.isInteger(v) && v > 0) out[k] = v;
  return out;
}

interface Designed {
  key: string;
  title: string;
  timeLimit?: { hours: number };
  final?: boolean;
  needToEnter?: string[];
  needToLeave?: string[];
}

/** The stage information of every lane: the Journey's design when there is one, the view's WIP limits always. */
export function useBoardStages(
  call: Call,
  journeyId: string | undefined,
  lanes: readonly Lane[],
  wip: Readonly<Record<string, number>>,
): BoardStages {
  const [design, setDesign] = useState<Designed[]>([]);
  const [late, setLate] = useState<Record<string, number>>({});
  const live = useRef(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!journeyId) {
      setDesign([]);
      setLate({});
      return;
    }
    let on = true;
    call("journeys.get", { journeyId })
      .then((o) => {
        if (on) setDesign((o as CapMap["journeys.get"]["out"]).journey.stages as unknown as Designed[]);
      })
      .catch(() => undefined);
    const counts = (): void => {
      call("journeys.stage_counts", { journeyId })
        .then((o) => {
          if (!on) return;
          const next: Record<string, number> = {};
          for (const s of (o as CapMap["journeys.stage_counts"]["out"]).stages) next[s.stage] = s.overLimit;
          setLate(next);
        })
        .catch(() => undefined);
    };
    counts();
    const t = setInterval(counts, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [call, journeyId, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const wipKey = JSON.stringify(wip);
  const by = useMemo(() => {
    const out: Record<string, StageInfo> = {};
    const w = JSON.parse(wipKey) as Record<string, number>;
    for (const l of lanes) {
      if (l.none) continue;
      const d = design.find((x) => x.key === l.key);
      out[l.key] = {
        key: l.key,
        title: l.title,
        ...(d?.timeLimit ? { limitHours: d.timeLimit.hours } : {}),
        ...(w[l.key] !== undefined ? { wip: w[l.key]! } : {}),
        ...(d?.final ? { final: true } : {}),
        ...(d?.needToEnter?.length ? { needToEnter: d.needToEnter } : {}),
        ...(d?.needToLeave?.length ? { needToLeave: d.needToLeave } : {}),
      };
    }
    return out;
  }, [design, lanes, wipKey]);
  return useMemo(() => ({ by, late, refresh }), [by, late, refresh]);
}
