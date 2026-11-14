// The first page of Automations wired to the place: the one list of Automations (what needs him, what ran today), the connector offer the server judged finishable, and what each press does.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { firstPage } from "../first/model.ts";
import type { SuggestionIn } from "../first/model.ts";
import { needsFromAutomations, summaryLine, todayFromAutomations } from "../first/from-list.ts";
import type { AutoRow } from "../sidebar/model.ts";
import { offersOf } from "../first/offers.ts";
import type { ConnectorOffer } from "../first/offers.ts";
import { RecoveryRequests } from "../operations/StudioViews.tsx";
import { FirstPageView } from "./FirstPageView.tsx";

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
  const [offers, setOffers] = useState<ConnectorOffer[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const fail = (e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work.");
  useEffect(() => {
    let live = true;
    void data.call("automations.connector_offers", {}).then(
      (out) => live && setOffers(offersOf(out)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data]);
  const rows = list.status === "ready" ? list.data.automations : [];
  const now = data.clock().now;
  const page = useMemo(() => {
    // the server offers only what the person's Assistant can finish with one approval (never a company key, never one an admin must clear), so each offer is finishable as it arrives
    const suggestions: SuggestionIn[] = offers.map((o) => ({
      id: o.itemId,
      app: { id: o.appName.toLowerCase(), name: o.appName },
      item: o.text,
      mayUse: true,
      knownService: true,
      assistant: "cleared",
    }));
    return firstPage({ needs: needsFromAutomations(rows), suggestions, today: todayFromAutomations(rows, now) });
  }, [rows, offers, now]);
  const offerOf = (id: string): ConnectorOffer | undefined => offers.find((o) => o.itemId === id);
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
      summary={summaryLine(rows)}
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
            setOffers((all) => all.filter((x) => x.itemId !== o.itemId));
          } catch (e) {
            fail(e);
          }
        })();
      }}
      onNotNow={(id) =>
        void data
          .call("automations.connector_offer.decline", { itemId: id })
          .then(() => setOffers((all) => all.filter((x) => x.itemId !== id)), fail)
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
