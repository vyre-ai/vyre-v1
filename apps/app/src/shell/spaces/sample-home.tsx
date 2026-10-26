// The real Home place inside the sample shell: the greeting, Needs you, My work, Projects at risk, While you were away, routines, then Today, Starred and the Ask box,
// drawn from the sample Space of the open Space. Other places keep their sample rows. Used by the shots mount that opens the shell on Home.
import { useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import Home from "../../places/home/index.tsx";
import { homeBSlots } from "../../places/home/sections-b/index.ts";
import { createSampleHomeB } from "../../places/home/sections-b/sample.ts";
import type { Variant } from "../../places/home/sections-b/sample.ts";
import { SamplePlace } from "./sample.tsx";
import type { PlaceContext } from "./Shell.tsx";

/** The sample variant a shell Space id stands for. */
export function homeVariantOf(spaceId: string): Variant {
  return spaceId === "hb" ? "harbor" : spaceId === "me" ? "personal" : "northwind";
}

function HomeBody({ spaceId }: { spaceId: string }): ReactElement {
  const sample = useMemo(() => createSampleHomeB(homeVariantOf(spaceId)), [spaceId]);
  const slots = useMemo(() => homeBSlots(sample.extras), [sample]);
  return <Home data={sample.data} top={slots.top} bottom={slots.bottom} />;
}

/** renderPlace for the shell: Home is the real page, every other place the sample rows. */
export function homePlace(ctx: PlaceContext): ReactNode {
  if (ctx.place === "home") return <HomeBody key={ctx.spaceId} spaceId={ctx.spaceId} />;
  return <SamplePlace ctx={ctx} />;
}
