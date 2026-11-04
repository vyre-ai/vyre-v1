// Reading the Space's projects for the sidebar: the list and the person's stars, read again when the Space changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { useFollow } from "../conversation/use-follow.ts";
import type { Changes } from "../conversation/use-follow.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { projectLines } from "./model.ts";
import type { ProjectLine } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export function useProjects(call: Call, changes: Changes | undefined, active = true): { lines: ProjectLine[]; reload(): void } {
  const [lines, setLines] = useState<ProjectLine[]>([]);
  const fn = useRef(call);
  fn.current = call;
  const reload = useCallback((): void => {
    void (async () => {
      try {
        const list = (await fn.current("projects.list", {})) as CapMap["projects.list"]["out"];
        const stars = await Promise.resolve(fn.current("stars.list", {})).catch(() => ({ stars: [] })) as { stars?: Array<{ resource: { type: string; id: string } }> };
        setLines(projectLines(list.projects, new Set((stars.stars ?? []).filter((s) => s.resource.type === "project").map((s) => s.resource.id))));
      } catch { /* the group keeps what it had */ }
    })();
  }, []);
  useEffect(() => { if (active) reload(); }, [active, reload]);
  useFollow(changes, reload, active);
  return { lines, reload };
}
