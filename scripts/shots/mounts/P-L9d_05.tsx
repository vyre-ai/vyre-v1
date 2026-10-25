// Mount for P-L9d_05: the project page over the sample Rivera engagement. Query (read after mount, ruling 25): ?tab=overview (default) | plan | files | chat, ?view=timeline | board | list | calendar.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ProjectPage } from "../../../apps/app/src/places/records/projectpage/ProjectPage.tsx";
import { ProjectPageDataProvider } from "../../../apps/app/src/places/records/projectpage/data.tsx";
import type { TabKey } from "../../../apps/app/src/places/records/projectpage/model.ts";
import { createSampleProject } from "../../../apps/app/src/places/records/projectpage/sample.ts";

export const title = "Project page";
const TABS: readonly TabKey[] = ["overview", "plan", "files", "chat"];

export default function Mount(): ReactNode {
  const sample = useMemo(() => createSampleProject(), []);
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (!q) return null;
  const tab = TABS.find((t) => t === q.get("tab")) ?? "overview";
  const view = (["timeline", "board", "list", "calendar"] as const).find((v) => v === q.get("view")) ?? "timeline";
  return (
    <ProjectPageDataProvider value={sample.data}>
      <View style={{ flex: 1, height: "100%" as unknown as number, backgroundColor: "var(--win)" as string }}>
        <ProjectPage projectId="pj_0" tab={tab} planView={view} />
      </View>
    </ProjectPageDataProvider>
  );
}
