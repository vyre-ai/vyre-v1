// Mount for P-L9c_04: the Inbox's Unmatched tab and the softphone dock over the Northwind sample Space (Harbor Studio with ?space=harbor).
// ?menu=match opens the Match menu of the first line  ?phone=dialer|incoming|live|ended drives the dock the way a person would (a click on the pill, a call ringing in, the answer, the hang-up).
// The state is read after mount (rule 25), so the static export never shows a stale one. Every control works against the sample replica; on a phone the sidebar is a drawer and only the list shows.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { harbor, northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import { InboxPhoneDock } from "../../../apps/app/src/places/inbox/softphone/index.ts";
import { InboxUnmatched } from "../../../apps/app/src/places/inbox/unmatched/index.ts";
import { createUnmatchedSample } from "../../../apps/app/src/places/inbox/unmatched/sample.ts";

export const title = "Inbox unmatched";

type Doc = { querySelector(s: string): { click?: () => void } | null };
const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;
const click = (id: string): void => doc()?.querySelector(`[data-testid="${id}"]`)?.click?.();

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const sample = useMemo(() => createUnmatchedSample(q.get("space") === "harbor" ? harbor : northwind), [q]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void): void => { timers.push(setTimeout(fn, ms)); };
    if (q.get("menu") === "match") at(400, () => click("match-unk"));
    const mode = q.get("phone");
    if (mode === "dialer") at(400, () => click("softphone-pill"));
    if (mode === "incoming") at(400, () => { sample.device.ring("+1 415 555 0161"); });
    if (mode === "live" || mode === "ended") {
      at(400, () => { sample.device.ring("+1 415 555 0161"); });
      at(800, () => click("softphone-answer"));
      if (mode === "ended") at(1400, () => click("softphone-hangup"));
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [q, sample]);
  return (
    <InboxDataProvider value={sample.data}>
      <InboxStateProvider initial={{}}>
        <InboxPhoneDock device={sample.device}>
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            {phone ? null : <View style={{ width: 240 }}><InboxSidebar /></View>}
            <InboxUnmatched />
          </View>
        </InboxPhoneDock>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
