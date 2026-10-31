// A Journey's stage design for the record page: which fields each stage holds. Read once per Journey type; null until it is known, and for a type no Journey owns.
import { useEffect, useState } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import { journeyOfType } from "./model.ts";
import type { Call } from "./model.ts";

/** What a stage adds to the generated contract: its fields and the two gates. */
export interface StageDesign {
  key: string; title: string; order: number; final?: boolean;
  fields?: readonly string[]; needToEnter?: readonly string[]; needToLeave?: readonly string[];
}

export async function stagesOfType(call: Call, type: string): Promise<{ journeyId: string; stages: StageDesign[] } | null> {
  const j = await journeyOfType(call, type);
  if (!j) return null;
  const out = (await call("journeys.get", { journeyId: j.id })) as CapMap["journeys.get"]["out"];
  return { journeyId: j.id, stages: out.journey.stages as unknown as StageDesign[] };
}

export function useJourneyStages(call: Call, type: string, enabled: boolean): { journeyId: string; stages: StageDesign[] } | null {
  const [found, setFound] = useState<{ journeyId: string; stages: StageDesign[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    stagesOfType(call, type).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound(null); });
    return () => { live = false; };
  }, [call, type, enabled]);
  return found;
}
