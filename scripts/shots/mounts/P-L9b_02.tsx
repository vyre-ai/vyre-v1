// Mount for P-L9b_02: the Home place with sections B (the first-run checklist, Today, Starred with live terminals, quick start and the Ask box) over the sample Spaces.
// ?v=northwind (default), harbor, personal (a Personal Space, nothing connected), firstrun (a new member of Northwind). ?scroll=s-today brings a lower section to the top.
// Every control works against the sample replica: unstar with Undo, hide the checklist, ask the assistant.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Home from "../../../apps/app/src/places/home/index.tsx";
import { homeBSlots } from "../../../apps/app/src/places/home/sections-b/index.ts";
import { createSampleHomeB } from "../../../apps/app/src/places/home/sections-b/sample.ts";
import type { Variant } from "../../../apps/app/src/places/home/sections-b/sample.ts";

export const title = "Home";

const VARIANTS: readonly Variant[] = ["northwind", "harbor", "personal", "firstrun"];

export default function Mount(): ReactNode {
  const sample = useMemo(() => {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
    const v = new URLSearchParams(search).get("v");
    return createSampleHomeB(VARIANTS.find((x) => x === v) ?? "northwind");
  }, []);
  const slots = useMemo(() => homeBSlots(sample.extras), [sample]);
  useEffect(() => {
    const g = globalThis as { location?: { search?: string }; document?: { querySelector(s: string): { scrollIntoView?: (o: unknown) => void } | null } };
    const id = new URLSearchParams(g.location?.search ?? "").get("scroll");
    if (!id) return;
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="${id}"]`)?.scrollIntoView?.({ block: "start" }), 300);
    return () => clearTimeout(t);
  }, []);
  return <Home data={sample.data} top={slots.top} bottom={slots.bottom} />;
}
