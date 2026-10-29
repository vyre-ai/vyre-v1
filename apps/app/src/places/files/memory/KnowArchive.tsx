// Files > Knowledge > Archive: the facts left untouched in Trash past the keep days. Out of search and out of recall. An admin restores one with the same Restore button as in Trash (an Undo follows);
// right-click: Restore, Open page, Open source, Copy. A member cannot read Archive (the read is refused for their role): the screen says so in one bar and draws no Restore.
import type { ReactElement } from "react";
import { View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { restoreFact, undoFact } from "./actions.ts";
import { useMemoryData } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";
import { Bar, ErrorLine, TrashRow, copyText, isDenied, openSourceOf, readError, removedBy, useDoing, useLiveSafe, whoOf } from "./KnowRows.tsx";
import type { KFact } from "./know.ts";
import { each } from "./model.ts";

export function KnowArchive(): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const now = data.now();
  const who = whoOf(data);
  const doing = useDoing();
  const aq = useLiveSafe("memory.trash.search", { area: "archive" });
  const trq = useLiveSafe("memory.trail", { limit: 500 });
  const member = isDenied(aq);
  const list = [...((aq.status === "ready" ? aq.data.facts : []) as KFact[])].sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  const trail = trq.status === "ready" ? trq.data.rows : [];
  const failed = member ? null : readError(aq, "Could not read Archive");

  const restore = (f: KFact): void => {
    doing.run("Could not restore the fact", () => restoreFact(data, f.factId), () => ({
      text: "Restored.",
      undo: () => doing.run("Could not move the fact back to Trash", () => undoFact(data, f.factId), () => ({ text: "Moved back to Trash." })),
    }));
  };
  const openPage = (f: KFact): void => { if (f.subject) nav.go({ v: "page", pageId: f.subject.pageId }); };
  const entries = (f: KFact): MenuEntry[] => [
    { label: "Restore", onSelect: () => restore(f) }, ...(f.subject ? [{ label: "Open page", onSelect: () => openPage(f) }] : []),
    { label: "Open source", onSelect: () => openSourceOf(nav, f) }, { separator: true }, { label: "Copy", onSelect: () => copyText(f.text) },
  ];

  return (
    <View style={frame.main} testID="know-archive">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Archive" }]} />
      <KnowColumn testID="know-archive-body" label="Archive" title="Archive" lede="Facts untouched in Trash for 60 days. They are out of search and out of recall. An admin can restore one, and the trail keeps every step.">
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        {member ? <Bar icon="lock" testID="archive-member" text="You are viewing as a member. Only Space admins can restore from Archive." /> : null}
        <View accessibilityRole="list" accessibilityLabel="Archive" testID="archive-rows" style={{ marginTop: 14 }}>
          {each(list, (f) => <TrashRow key={f.factId} fact={f} who={who} by={removedBy(trail, f)} now={now} keep={60} archive canRestore onRestore={() => restore(f)} onOpen={() => openPage(f)} menu={() => entries(f)} />)}
        </View>
        {!member && list.length === 0 && aq.status === "ready" ? <Empty title="Archive is empty" text="Nothing has aged out of Trash yet." /> : null}
        {member ? <Empty title="Archive is for admins" text="Ask a Space admin to restore something from here." /> : null}
      </KnowColumn>
    </View>
  );
}
