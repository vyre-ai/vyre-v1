// Mount for l-editor: the project Overview page (OverviewPage) against its in-memory stand-in, in the real browser editor. ?agent=1 has an agent edit the page first; ?read=1 reads it with no edit access.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { ProjectPageDataProvider } from "../../../apps/app/src/places/records/projectpage/data.tsx";
import { OverviewPage } from "../../../apps/app/src/places/records/projectpage/overview/OverviewPage.tsx";
import { createSampleOverview } from "../../../apps/app/src/places/records/projectpage/overview/sample.ts";
import type { SampleOverview } from "../../../apps/app/src/places/records/projectpage/overview/sample.ts";

export const title = "Project Overview page";

export default function Mount() {
  const [s, setS] = useState<{ sample: SampleOverview; read: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
    const sample = createSampleOverview();
    if (q.get("agent") === "1") sample.agentEdits('added a live metric block "Unpaid"', `${sample.state().markdown}\n\n<!--b:blk_y1-->\n:::live {"type":"metric","spec":{"title":"Unpaid","type":"invoice","op":"sum","field":"amount"},"view":"count"}`);
    setS({ sample, read: q.get("read") === "1" });
  }, []);
  if (s === null) return <View style={{ flex: 1 }} />;
  return <View style={{ flex: 1, minHeight: 0 }} testID="overview-mount"><ProjectPageDataProvider value={s.sample.data}><OverviewPage projectId="prj_rivera" canEdit={!s.read} /></ProjectPageDataProvider></View>;
}
