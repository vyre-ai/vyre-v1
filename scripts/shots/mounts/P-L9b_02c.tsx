// Mount for P-L9b_02c: the Personal Space Home (greeting and the Your Personal Space subtitle, Get started with four rows, no empty sections, Quick start and the locked Ask box).
// ?v=personal (default), northwind (the Team Space page, to see the sections come back). Reads the query after mount, as every mount does (static export keeps first-render markup).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Home from "../../../apps/app/src/places/home/index.tsx";
import { homeBSlots } from "../../../apps/app/src/places/home/sections-b/index.ts";
import { createSampleHomeB } from "../../../apps/app/src/places/home/sections-b/sample.ts";

export const title = "Home (Personal Space)";

export default function Mount(): ReactNode {
  const [v, setV] = useState<"personal" | "northwind">("personal");
  useEffect(() => {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
    if (new URLSearchParams(search).get("v") === "northwind") setV("northwind");
  }, []);
  const sample = useMemo(() => createSampleHomeB(v), [v]);
  const slots = useMemo(() => homeBSlots(sample.extras), [sample]);
  return <Home data={sample.data} top={slots.top} bottom={slots.bottom} personal={v === "personal"} />;
}
