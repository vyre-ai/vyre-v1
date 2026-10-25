// Mount for P-L9b_01: the Home place with sections A (Needs you, My work, Projects at risk, While you were away, Routines today) over the Northwind sample Space, or Harbor Studio
// with ?space=harbor. Every control works against the sample replica: approve, complete, assign from a face, mark seen, undo.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Home from "../../../apps/app/src/places/home/index.tsx";
import { createSampleHome, harbor, northwind } from "../../../apps/app/src/places/home/sections-a/sample.ts";

export const title = "Home";

export default function Mount(): ReactNode {
  const space = useMemo(() => {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
    return new URLSearchParams(search).get("space") === "harbor" ? harbor : northwind;
  }, []);
  const sample = useMemo(() => createSampleHome(space), [space]);
  // ?scroll=s-risk brings a lower section to the top so the screenshot shows it
  useEffect(() => {
    const g = globalThis as { location?: { search?: string }; document?: { querySelector(s: string): { scrollIntoView?: (o: unknown) => void } | null } };
    const id = new URLSearchParams(g.location?.search ?? "").get("scroll");
    if (!id) return;
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="${id}"]`)?.scrollIntoView?.({ block: "start" }), 300);
    return () => clearTimeout(t);
  }, []);
  return <Home data={sample.data} />;
}
