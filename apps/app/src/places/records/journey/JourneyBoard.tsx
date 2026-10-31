// The Journey type's board: the ordinary board, running on the stage field, where a drop moves the record's stage through the Journeys module and a column's plus starts a subject record
// at that stage. Until the Journey is found (one read) the plain board's loading frame shows.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useRecordsData } from "../sidebar/data.tsx";
import { TableLoading } from "../table/index.ts";
import { BoardView } from "../views-a/BoardView.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { optionsOf } from "../table/model.ts";
import type { RecordRow } from "../table/model.ts";
import { GateSheet } from "./GateSheet.tsx";
import { GateError, journeyOfType, moveInJourney, startInJourney, stageFieldOf, subjectTitles } from "./model.ts";
import type { JourneyBinding, MissingField } from "./model.ts";

/** A move the stage refused for want of fields: the card, where it was going and what is missing. */
export interface Gated { row: RecordRow; stage: string; missing: readonly MissingField[] }

/** The binding of a Journey type once its Journey is known; undefined while it loads, null when no Journey owns the type. */
export function useJourneyBinding(type: string, def: ViewCtx["def"], onGate?: (g: Gated) => void): JourneyBinding | null | undefined {
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
      move: async (row, stage) => {
        try { await moveInJourney(data.call, found.id, row, stage); } catch (e) {
          // a stage waiting on fields asks for them in a sheet instead of failing
          if (e instanceof GateError && onGate) { onGate({ row, stage, missing: e.missing }); return; }
          throw e;
        }
      },
      addChoices: async (stage, done) => {
        const at = stage ?? first;
        if (!at) return [{ head: "This Journey has no stages." }];
        const rows = await subjectTitles(data.call, found.subjectType);
        if (rows.length === 0) return [{ head: "Nothing to add yet. Make a record first." }];
        return rows.map((r) => ({ label: r.title, onSelect: () => { startInJourney(data.call, found.id, r.id, at).then(() => done(null)).catch((e: unknown) => done(e instanceof Error ? e.message : "Could not add it.")); } }));
      },
    } satisfies JourneyBinding;
  }, [found, field, data, onGate]);
}

export function JourneyBoard({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const [gate, setGate] = useState<Gated | null>(null);
  const binding = useJourneyBinding(ctx.type, ctx.def, setGate);
  if (binding === undefined) return <TableLoading />;
  return (
    <>
      <BoardView ctx={binding ? { ...ctx, journey: binding } : ctx} />
      {gate && binding ? (
        <GateSheet
          call={data.call} journeyId={binding.journeyId} type={ctx.type} def={ctx.def} row={gate.row} toStage={gate.stage} missing={gate.missing}
          stageTitle={optionsOf(binding.field).find((o) => o.key === gate.stage)?.title ?? gate.stage} onDone={() => setGate(null)} onClose={() => setGate(null)}
        />
      ) : null}
    </>
  );
}
