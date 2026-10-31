// Files > Knowledge > Trash: the facts that were deleted or merged away, and the pages moved to Trash. Agents do not recall them, search can find them. Each row is the subject, the struck-through text,
// why it is here, who removed it and when, and how many days are left before it moves to Archive (orange at 14 or fewer). Restore puts it back in one click (the line that says so has an Undo that
// sends it back); right-click: Restore, Open page, Open source, Copy. An admin also has "Keep 60 days" in the header (30, 45, 60 or 90 as checkmarks). With a page id the screen shows only that page's facts.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { errorText, restoreFact, restorePage, trashPage, undoFact } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";
import { ErrorLine, FilterBanner, TrashPageRow, TrashRow, copyText, isDenied, openSourceOf, readError, removedBy, useDoing, useLiveSafe, whoOf } from "./KnowRows.tsx";
import type { KFact } from "./know.ts";
import { each } from "./model.ts";
import { QuietButton } from "./parts.tsx";

export const KEEP_CHOICES: readonly number[] = [30, 45, 60, 90];

export function KnowTrash({ pageId }: { pageId?: string }): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const now = data.now();
  const who = whoOf(data);
  const menu = useMenu();
  const doing = useDoing();
  const [keep, setKeep] = useState(60);
  const tq = useLive("memory.trash.search", { area: "trash" });
  const trq = useLive("memory.trail", { limit: 500 });
  const probe = useLiveSafe("memory.trash.search", { area: "archive", limit: 1 });
  const pq = useLiveSafe("memory.page.get", { pageId: pageId ?? "" }, !pageId);
  const admin = probe.status === "ready" && !isDenied(probe);
  const all = (tq.status === "ready" ? tq.data.facts : []) as KFact[];
  const pages = pageId || tq.status !== "ready" ? [] : tq.data.pages ?? [];
  const trail = trq.status === "ready" ? trq.data.rows : [];
  const list = (pageId ? all.filter((f) => f.subject?.pageId === pageId) : [...all]).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  const pageTitle = pageId && pq.status === "ready" ? pq.data.page.title : "this page";
  const failed = readError(tq, "Could not read Trash");

  const restore = (f: KFact): void => {
    doing.run("Could not restore the fact", () => restoreFact(data, f.factId), () => ({
      text: "Restored.",
      undo: () => doing.run("Could not move the fact back to Trash", () => undoFact(data, f.factId), () => ({ text: "Moved back to Trash." })),
    }));
  };
  const restorePg = (p: { pageId: string; title: string }): void => {
    doing.run("Could not restore the page", () => restorePage(data, p.pageId), () => ({
      text: `Restored ${p.title}.`,
      undo: () => doing.run("Could not move the page back to Trash", () => trashPage(data, p.pageId), () => ({ text: "Moved back to Trash." })),
    }));
  };
  const openPage = (f: KFact): void => { if (f.subject) nav.go({ v: "page", pageId: f.subject.pageId }); };
  const entries = (f: KFact): MenuEntry[] => [
    { label: "Restore", onSelect: () => restore(f) }, ...(f.subject ? [{ label: "Open page", onSelect: () => openPage(f) }] : []),
    { label: "Open source", onSelect: () => openSourceOf(nav, f) }, { separator: true }, { label: "Copy", onSelect: () => copyText(f.text) },
  ];
  const keepEntries = (): MenuEntry[] => [
    { head: "Keep in Trash for" },
    ...each(KEEP_CHOICES, (d): MenuEntry => ({ label: `${d} days${d === 60 ? " (default)" : ""}`, checked: keep === d, onSelect: () => { const before = keep; setKeep(d); data.call("settings.set_space", { key: "memory.trash_days", value: d, idempotencyKey: `trash-days-${d}-${data.now()}` }).then(() => doing.setFlash({ text: `Facts now stay in Trash ${d} days before they move to Archive.` })).catch((e: unknown) => { setKeep(before); doing.setFlash({ text: errorText(e, "Could not change the days") }); }); } })),
  ];
  const right = admin ? <QuietButton icon="clock" label={`Keep ${keep} days`} testID="trash-keep" onPress={(x, y) => menu.show(keepEntries(), x, y, "other")} /> : null;

  return (
    <View style={frame.main} testID="know-trash">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Trash" }]} right={right} />
      <KnowColumn
        testID="know-trash-body" label="Trash" title="Trash"
        lede={`Deleted or merged facts. Restore one with a click. After ${keep} days they move to Archive.`}
      >
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        {pageId ? <FilterBanner text={`Only ${pageTitle} · ${list.length} shown`} onClear={() => nav.go({ v: "trash" })} /> : null}
        <View accessibilityRole="list" accessibilityLabel="Trash" testID="trash-rows" style={{ marginTop: 14 }}>
          {each(list, (f) => <TrashRow key={f.factId} fact={f} who={who} by={removedBy(trail, f)} now={now} keep={keep} archive={false} canRestore onRestore={() => restore(f)} onOpen={() => openPage(f)} menu={() => entries(f)} />)}
          {each(pages, (p) => <TrashPageRow key={p.pageId} page={p} onRestore={() => restorePg(p)} menu={() => [{ label: "Restore", onSelect: () => restorePg(p) }]} />)}
        </View>
        {list.length === 0 && pages.length === 0 && tq.status === "ready" ? <Empty title="Trash is empty" text="Nothing was deleted or merged away." /> : null}
      </KnowColumn>
      {menu.element}
    </View>
  );
}
