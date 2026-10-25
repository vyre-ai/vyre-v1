// Journey data hooks: the live Journey and its stage counts through the generated screen queries, and the write every edit goes through. A design is saved whole with the version it
// started from (journeys.design checks it), a write that fails shows why, and a write that works shows a quiet line with Undo, which writes the previous design back.
import { useCallback } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { useSaved } from "../config/saved.ts";
import type { Saved } from "../config/saved.ts";
import type { Journey, Stage, StageCounts, StartRule } from "./model.ts";

export const DESIGNER = "journeys.designer";

type GetOut = CapMap["journeys.get"]["out"];
type CountsOut = CapMap["journeys.stage_counts"]["out"];
type VersionsOut = CapMap["journeys.versions"]["out"];

export interface JourneyState { phase: "loading" | "gone" | "ready"; journey?: Journey; counts: StageCounts; versions: VersionsOut["versions"] }

export function useJourney(journeyId: string): JourneyState {
  const q = useScreenQuery<GetOut>(DESIGNER, "journey", { journeyId });
  const c = useScreenQuery<CountsOut>(DESIGNER, "counts", { journeyId });
  const v = useScreenQuery<VersionsOut>(DESIGNER, "versions", { journeyId });
  const counts = c.status === "ready" ? c.data.stages : [];
  const versions = v.status === "ready" ? v.data.versions : [];
  if (q.status !== "ready") return { phase: "loading", counts, versions };
  const journey = q.data.journey as Journey | undefined;
  return journey ? { phase: "ready", journey, counts, versions } : { phase: "gone", counts, versions };
}

export interface Design {
  saved: Saved;
  /** Save a new list of stages (and optionally the start rule); `text` is the quiet line, Undo writes the previous list back. */
  design(next: readonly Stage[], text: string, startRule?: StartRule | null): Promise<boolean>;
  rename(name: string): Promise<boolean>;
  setRule(stageKey: string, patch: { exit?: Stage["exit"]; timeLimit?: Stage["timeLimit"] | null }, text: string): Promise<boolean>;
}

export function useDesign(journey: Journey | undefined): Design {
  const data = useAutomationsData();
  const saved = useSaved();
  const id = journey?.id ?? "";
  const design = useCallback(async (next: readonly Stage[], text: string, startRule?: StartRule | null): Promise<boolean> => {
    if (!journey) return false;
    const prev = journey.stages;
    return saved.run(
      text,
      () => data.call("journeys.design", { journeyId: id, stages: next, ...(startRule !== undefined ? { startRule } : {}), expectedVersion: journey.version }),
      () => data.call("journeys.design", { journeyId: id, stages: prev, ...(startRule !== undefined ? { startRule: journey.startRule ?? null } : {}), expectedVersion: journey.version + 1 }),
    );
  }, [data, journey, saved, id]);
  const rename = useCallback(async (name: string): Promise<boolean> => {
    if (!journey || !name.trim() || name.trim() === journey.name) return false;
    const old = journey.name;
    return saved.run(`Renamed to ${name.trim()}`, () => data.call("journeys.rename", { journeyId: id, name: name.trim() }), () => data.call("journeys.rename", { journeyId: id, name: old }));
  }, [data, journey, saved, id]);
  const setRule = useCallback(async (stageKey: string, patch: { exit?: Stage["exit"]; timeLimit?: Stage["timeLimit"] | null }, text: string): Promise<boolean> => {
    if (!journey) return false;
    const old = journey.stages.find((s) => s.key === stageKey);
    return saved.run(
      text,
      () => data.call("journeys.rules.set", { journeyId: id, stageKey, ...patch }),
      () => data.call("journeys.rules.set", { journeyId: id, stageKey, exit: old?.exit ?? { requireTasks: true }, timeLimit: old?.timeLimit ?? null }),
    );
  }, [data, journey, saved, id]);
  return { saved, design, rename, setRule };
}
