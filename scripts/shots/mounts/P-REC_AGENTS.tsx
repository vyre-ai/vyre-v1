// Mount for the Agents view in Records: the agents themselves over the Northwind sample, with one old row that has no agent behind it. ?empty=1 (no agents and no rows), ?fail=1 (the list could not be read).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../../../apps/app/src/places/records/sidebar/index.ts";
import { AgentsView } from "../../../apps/app/src/places/records/views-a/AgentsView.tsx";
import { createViewsSample, northwind } from "../../../apps/app/src/places/records/views-a/sample.ts";

export const title = "Records: Agents";

const AGENTS = [
  { agentId: "agt_intake", name: "Intake", role: "Use me when a new client form arrives." },
  { agentId: "agt_docs", name: "Docs Writer", role: "Use me to draft letters and filings." },
  { agentId: "agt_scout", name: "Scout", role: "Use me to look a company up." },
];

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const sample = useMemo(() => createViewsSample(northwind, {}), []);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  const data = useMemo(() => ({
    ...sample.data,
    call: async (cap: string, input: unknown) => {
      if (cap !== "agents.list") return sample.data.call(cap, input);
      if (q.get("fail") === "1") throw new Error("offline");
      return { agents: q.get("empty") === "1" ? [] : AGENTS };
    },
    nav: { ...sample.data.nav, openAgent: () => undefined },
  }), [sample, q]);
  return (
    <RecordsDataProvider value={data}>
      <RecordsStateProvider initial={{ type: "agents" }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><RecordsSidebar /></View>}
          <AgentsView def={{ key: q.get("empty") === "1" ? "no_such_type" : "agents", plural: "Agents", titleField: "name" } as never} />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}

/** The query is read after the page is live (the static export keeps the markup it was rendered with), so the mount draws once the query is known. */
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
