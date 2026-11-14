// The subagents of a running turn on screen with no read and no timer (F41, P7): the turn's live activity already carries each Agent call (its task, whether it still runs) and, for the person the turn runs for,
// what each subagent is on. This turns that into crew rows and hands them to the crew context, where the block, the island, the header chip and the pane draw them beside the read.
import { useEffect, useRef } from "react";
import type { ActivityStore, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { turnRowId } from "../../../shell/session/turn-streams.ts";
import { stepLabel } from "../conversation/activity.ts";
import { useCrew } from "./context.tsx";
import { subagentsOfActivity } from "./model.ts";

export function LiveSubagents({
  turns,
  activityOf,
  me,
}: {
  turns: readonly Pick<LiveTurn, "turnId" | "threadId" | "agentId" | "asker">[];
  /** The person looking: only the one the turn runs for gets task lines and steps. */
  me: string;
  activityOf: ((rowId: string) => ActivityStore | undefined) | undefined;
}): null {
  const setLive = useCrew()?.setLive;
  // the lookup is read through a ref: a new function on each render must not tear the subscriptions down
  const lookup = useRef(activityOf);
  lookup.current = activityOf;
  useEffect(() => {
    const activityOf = lookup.current;
    if (!setLive || !activityOf) return undefined;
    const stores = turns.flatMap((t) => {
      const s = activityOf(turnRowId(t.turnId));
      return s ? [{ t, s }] : [];
    });
    const compute = (): void =>
      setLive(stores.flatMap(({ t, s }) => subagentsOfActivity(t, s.get(), stepLabel, Date.now(), t.asker === me)));
    compute();
    const off = stores.map(({ s }) => s.subscribe(compute));
    return () => {
      for (const f of off) f();
      setLive([]);
    };
  }, [turns, setLive, me]);
  return null;
}
