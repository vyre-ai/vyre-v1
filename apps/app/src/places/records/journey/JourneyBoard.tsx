// The Journey type's board: the ordinary board, running on the stage field, where a drop moves the record's stage through the Journeys module and a column's plus starts a subject record
// at that stage. Until the Journey is found (one read) the plain board's loading frame shows.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useRecordsData } from "../sidebar/data.tsx";
import { TableLoading } from "../table/index.ts";
import { BoardView } from "../views-a/BoardView.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { optionsOf } from "../table/model.ts";
import { journeyOfType, moveInJourney, startInJourney, stageFieldOf, subjectTitles } from "./model.ts";
import type { JourneyBinding } from "./model.ts";

/** The binding of a Journey type once its Journey is known; undefined while it loads, null when no Journey owns the type. */
export function useJourneyBinding(type: string, def: ViewCtx["def"]): JourneyBinding | null | undefined {
  const data = useRecordsData();
  const [found, setFound] = useState<{ id: string; subjectType: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    journeyOfType(data.call, type).then((j) => { if (live) setFound(j); }).catch(() => { if (live) setFound(null); });
    return () => { live = false; };
  }, [data, type]);
  const field = stageFieldOf(def);
  return useMemo(() => {
    if (found === undefined) return undefined;
    if (!found || !field) return null;
    const first = optionsOf(field)[0]?.key;
    return {
      journeyId: found.id, subjectType: found.subjectType, field,
      move: async (row, stage) => { await moveInJourney(data.call, found.id, row, stage); },
      addChoices: async (stage, done) => {
        const at = stage ?? first;
        if (!at) return [{ head: "This Journey has no stages." }];
        const rows = await subjectTitles(data.call, found.subjectType);
        if (rows.length === 0) return [{ head: "Nothing to add yet. Make a record first." }];
        return rows.map((r) => ({ label: r.title, onSelect: () => { startInJourney(data.call, found.id, r.id, at).then(() => done(null)).catch((e: unknown) => done(e instanceof Error ? e.message : "Could not add it.")); } }));
      },
    } satisfies JourneyBinding;
  }, [found, field, data]);
}

export function JourneyBoard({ ctx }: { ctx: ViewCtx }): ReactElement {
  const binding = useJourneyBinding(ctx.type, ctx.def);
  if (binding === undefined) return <TableLoading />;
  return <BoardView ctx={binding ? { ...ctx, journey: binding } : ctx} />;
}
