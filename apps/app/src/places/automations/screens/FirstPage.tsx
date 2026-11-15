// The first page of Automations wired to the place: the one list of Automations (what needs him, what ran today), the connector offer the server judged finishable, and what each press does.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { firstPage } from "../first/model.ts";
import type { SuggestionIn } from "../first/model.ts";
import type { AutoRow } from "../sidebar/model.ts";
import type { ConnectorOffer } from "../first/offers.ts";
import { RecoveryRequests } from "../operations/StudioViews.tsx";
import { FirstPageView } from "./FirstPageView.tsx";

interface HomeOut {
  needs: { id: string; automation: string; why: string; at: number; runId?: string }[];
  suggestion?: ConnectorOffer;
  today: { ran: number; failed: { runId: string }[] };
  counts: { total: number; on: number; needYou: number };
}

export function FirstPage({
  onExamples,
  onAllRuns,
  onAsk,
}: {
  onExamples(): void;
  onAllRuns(): void;
  onAsk(): void;
}): ReactElement {
  const data = useAutomationsData();
  const list = useScreenQuery<{ automations: readonly AutoRow[] }>(SIDEBAR, "automations", {});
  const [note, setNote] = useState<string | null>(null);
  const fail = (e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work.");
  // what the page shows is decided on the server and read in one call: what needs the person, at most one suggestion, the Today line, the counts. It is read again whenever the list changes.
  const rows = list.status === "ready" ? list.data.automations : [];
  const signature = rows
    .map((a) => `${a.id}:${a.status}:${a.lastRun?.runId ?? ""}:${a.lastRun?.status ?? ""}:${a.failedRuns}`)
    .join("|");
  const [home, setHome] = useState<HomeOut | null>(null);
  useEffect(() => {
    let live = true;
    void data.call("automations.home", {}).then(
      (out) => live && setHome(out as HomeOut),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, signature]);
  const offers: ConnectorOffer[] = home?.suggestion ? [home.suggestion] : [];
  const [gone, setGone] = useState<readonly string[]>([]);
  const shown = offers.filter((o) => !gone.includes(o.itemId));
  const now = data.clock().now;
  const page = useMemo(() => {
    const suggestions: SuggestionIn[] = shown.map((o) => ({
      id: o.itemId,
      app: { id: o.appName.toLowerCase(), name: o.appName },
      item: o.text,
      mayUse: true,
      knownService: true,
      assistant: "cleared",
    }));
    return firstPage({
      needs: (home?.needs ?? []).map((n) => ({ ...n, fix: { label: "Open it", kind: "see" as const } })),
      suggestions,
      today: { ran: home?.today.ran ?? 0, failed: home?.today.failed ?? [] },
    });
  }, [home, gone]);
  const offerOf = (id: string): ConnectorOffer | undefined => shown.find((o) => o.itemId === id);
  const create = (): void => {
    setNote(null);
    void data.call("automations.create", { name: "New automation" }).then((out) => {
      const id = (out as { automation?: { id?: string } })?.automation?.id;
      if (id) data.nav.openAutomation(id);
    }, fail);
  };
  return (
    <FirstPageView
      page={page}
      now={now}
      summary={
        home && home.counts.total > 0
          ? `${home.counts.on === 0 ? "None on" : `${home.counts.on} on`}${home.counts.needYou > 0 ? `, ${home.counts.needYou} ${home.counts.needYou === 1 ? "needs" : "need"} you` : ""}`
          : ""
      }
      onFix={(id) => data.nav.openAutomation(id)}
      onSeeRun={(runId) => data.nav.openRun(runId)}
      onSetUp={(id) => {
        const o = offerOf(id);
        if (!o || !data.nav.setUpConnector) return;
        setNote(null);
        // the session starts first: a setup that cannot start keeps the offer instead of using it up
        void (async () => {
          try {
            await data.nav.setUpConnector!(o);
            await data.call("automations.connector_offer.accept", { itemId: o.itemId });
            setGone((all) => [...all, o.itemId]);
          } catch (e) {
            fail(e);
          }
        })();
      }}
      onNotNow={(id) =>
        void data
          .call("automations.connector_offer.decline", { itemId: id })
          .then(() => setGone((all) => [...all, id]), fail)
      }
      onNew={create}
      onExamples={onExamples}
      onAllRuns={onAllRuns}
      onAsk={onAsk}
      note={note}
      extra={<RecoveryRequests />}
    />
  );
}
