// Mount for lane l-chrome2b: Automations > Watching, the pages and parts of pages that an agent or the person's own Chrome checks, over scripted automations.watches.list answers.
//   ?part=list (the list), open (a watch opened: what the page was and what it is, who checks it), empty (nothing watched yet), paused (one paused, one that cannot be read)
// The query is read after mount (the static export keeps the first frame's markup), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { Watching } from "../../../apps/app/src/places/automations/operations/WatchingView.tsx";
import { createSampleAutomations, northwind } from "../../../apps/app/src/places/automations/sidebar/sample.ts";

export const title = "Automations > Watching";

const NOW = Date.UTC(2026, 10, 3, 16, 30);
const min = (n: number): number => NOW - n * 60_000;
const W = (o: Record<string, unknown>) => ({ tell: [], checkNow: false, changes: 0, createdAt: min(9000), updatedAt: min(5), state: "on", ...o });
const ROWS = [
  W({ watchId: "wch_1", title: "Lab 8 registrations", url: "https://lu.ma/mla-ai-lab-8", host: "lu.ma", mode: "region", region: { label: "Guest count" }, everyMinutes: 30, agentId: "agt_ops", runsOn: "computer", value: "3,598 going", lastCheckedAt: min(12), changes: 14, lastChange: { at: min(40), before: "3,570 going", after: "3,598 going" } }),
  W({ watchId: "wch_2", title: "Okafor docket", url: "https://hcdistrictclerk.com/case/20251101", host: "hcdistrictclerk.com", mode: "page", everyMinutes: 120, agentId: "agt_ops", runsOn: "computer", value: "Hearing set 12 Nov", lastCheckedAt: min(30), changes: 2, lastChange: { at: min(300), before: "Hearing set 5 Nov", after: "Hearing set 12 Nov" } }),
  W({ watchId: "wch_3", title: "Competitor pricing: LawLeads Pro", url: "https://lawleadspro.com/pricing", host: "lawleadspro.com", mode: "region", region: { label: "Pricing table" }, everyMinutes: 1440, agentId: "agt_research", runsOn: "chrome", value: "Pro $499 a month", lastCheckedAt: min(60 * 9 * 24 - 5) }),
  W({ watchId: "wch_4", title: "Marisol Vega's stage", url: "https://app.gohighlevel.com/contacts/c_8812", host: "app.gohighlevel.com", mode: "region", region: { label: "Opportunity stage" }, everyMinutes: 60, agentId: "agt_scout", runsOn: "chrome", state: "paused", value: "Booked", lastCheckedAt: min(60 * 40) }),
];

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "list"), []);
  const sample = useMemo(() => createSampleAutomations(northwind), []);
  const height = useWindowDimensions().height;
  const data = useMemo(() => ({
    ...sample.data,
    clock: () => ({ now: NOW }),
    name: (id: string) => ({ agt_ops: "Ops", agt_scout: "Scout", agt_research: "Research" } as Record<string, string>)[id] ?? sample.data.name(id),
    call: async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "automations.watches.list") {
        const rows = part === "empty" ? [] : part === "paused" ? [ROWS[3]!, W({ watchId: "wch_5", title: "Weinberger intake form", url: "https://weinberger.example/intake", host: "weinberger.example", mode: "page", everyMinutes: 60, agentId: "agt_scout", runsOn: "chrome", state: "error", error: "The page did not finish loading." }), ROWS[0]!] : ROWS;
        return { watches: rows };
      }
      return sample.data.call(cap, input);
    },
  }), [sample, part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <AutomationsDataProvider value={data}>
      <View style={{ height, backgroundColor: "var(--win)" as string }}><Watching {...(part === "open" ? { initialOpen: "wch_1" } : {})} /></View>
    </AutomationsDataProvider>
  );
}
