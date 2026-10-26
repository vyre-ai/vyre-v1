// Mount for P-L9e_05: the memory graph and the proposed facts over the Northwind sample Space (or Harbor Studio with ?space=harbor). Today is Oct 24, 2025.
// ?part=graph (default)|proposed  ?scope=agent|space  ?agent=agt_docs  ?select=elena  ?step=18 (the time slider: 30 is now)  ?find=rivera  ?menu=layers|kinds opens that header menu on load
// Both views sit in the Files place: its sidebar (FilesTree) on the left at 240 px (a phone shows the view alone), the view beside it.
// The page reads its query after it is live (the static export keeps the markup it was rendered with). Every control works against the sample replica.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createSampleFiles, harbor as filesHarbor, northwind as filesNorthwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { MemoryDataProvider, MemoryGraph, MemoryProposed } from "../../../apps/app/src/places/files/memory/index.ts";
import { createSampleMemory, harbor, northwind } from "../../../apps/app/src/places/files/memory/sample.ts";

export const title = "Files: Memory graph and proposed facts";

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleMemory(space), [space]);
  const agent = q.get("agent") ?? space.agents[0]?.id;
  const files = useMemo(() => createSampleFiles(q.get("space") === "harbor" ? filesHarbor : filesNorthwind), [q]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const menu = q.get("menu");
    if (!menu) return;
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="graph-${menu}"]`)?.click?.(), 500);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <FilesDataProvider value={files.data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: null } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><FilesTree /></View>}
          <MemoryDataProvider value={sample.data}>
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              {q.get("part") === "proposed"
                ? <MemoryProposed {...(agent ? { agentId: agent } : {})} />
                : <MemoryGraph {...(agent ? { agentId: agent } : {})} scope={q.get("scope") === "space" ? "space" : "agent"} selected={q.get("select")} step={q.get("step") ? Number(q.get("step")) : 30} find={q.get("find") ?? ""} />}
            </View>
          </MemoryDataProvider>
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
