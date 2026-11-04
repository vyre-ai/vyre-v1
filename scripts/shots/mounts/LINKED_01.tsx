// Mount for the project Linked tab (lane l-linked): the Rivera project's Linked tab over the scripted Projects server, framed like the project page (title, facts, the tab strip). ?part=
//   tab (default)  Linked with its groups, the auto marks, the rules and the CI rows   empty  nothing linked yet   member  read-only: no Link something, no rules   noci  a project with no linked repository
// The tab's own states (the peek, the Show menu, the sheets) are reached by clicking, as a person would; the screenshot script lists the clicks.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { TabStrip } from "../../../ui/src/TabStrip/index.tsx";
import { ProjectPageDataProvider } from "../../../apps/app/src/places/records/projectpage/data.tsx";
import { LinkedTab } from "../../../apps/app/src/places/records/projectpage/linked/LinkedTab.tsx";
import { createSampleLinked } from "../../../apps/app/src/places/records/projectpage/linked/sample.ts";

export const title = "Project Linked";

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "tab"), []);
  const s = useMemo(() => (part === null ? null : createSampleLinked({ ...(part === "empty" ? { empty: true, ci: false } : {}), ...(part === "noci" ? { ci: false } : {}) })), [part]);
  if (part === null || s === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <ProjectPageDataProvider value={s.data}>
      <View style={{ flex: 1, backgroundColor: "var(--win)" as string, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 760, flex: 1, minHeight: 0 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 }}>
            <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "600", color: "var(--ink)" as string }}>Rivera account</Text>
            <Text style={{ fontSize: 13, color: "var(--ink-3)" as string, marginTop: 4 }}>On track · Lead Maya Chen · Due 14 Nov</Text>
          </View>
          <TabStrip underline tabs={[{ key: "overview", title: "Overview" }, { key: "plan", title: "Plan" }, { key: "files", title: "Linked" }, { key: "chat", title: "Chat" }]} active="files" onSelect={() => undefined} />
          <LinkedTab projectId="prj_rivera" projectTitle="Rivera account" canEdit={part !== "member"} say={setSaid} openUrl={() => undefined} askAssistant={() => undefined} />
          {said !== "" ? <Text style={{ position: "absolute", bottom: 12, left: 16, fontSize: 12.5, color: "var(--ink-3)" as string }}>{said}</Text> : null}
        </View>
      </View>
    </ProjectPageDataProvider>
  );
}
