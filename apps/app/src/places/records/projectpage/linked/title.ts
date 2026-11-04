import { useEffect, useState } from "react";
import { useProjectPageData } from "../data.tsx";

/** The project's name, for the lines that say where something was linked ("Linked to Rivera account"). */
export function usePageTitle(projectId: string): string {
  const d = useProjectPageData();
  const [t, setT] = useState("this project");
  useEffect(() => {
    let live = true;
    void Promise.resolve(d.call("projects.get", { projectId })).then((o) => { const v = (o as { project?: { title?: string } }).project?.title; if (live && typeof v === "string" && v !== "") setT(v); }, () => undefined);
    return () => { live = false; };
  }, [d, projectId]);
  return t;
}
