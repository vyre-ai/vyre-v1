// Files > Knowledge > People, Clients, Projects, Topics (one screen, told apart by `kind`): the pages of that kind, newest activity first. Each row has the tile, the name (with the organisation in
// muted words), what the page is about, the layer it lives in, how many facts it holds and how many sit in Trash. A press (or Enter) opens the page. The "..." at the right, and a right-click, open
// Open, Open in Graph and Move to Trash (the line that says so has an Undo that restores the page).
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { restorePage, trashPage } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";
import { ErrorLine, KRow, copyText, readError, useDoing } from "./KnowRows.tsx";
import { SubjectTile } from "./KnowParts.tsx";
import { LAYER_NAME, LIST_LEDE, LIST_TITLE, plural } from "./know.ts";
import type { KFact, ListKind } from "./know.ts";
import type { PageRow } from "./know.ts";
import { each } from "./model.ts";
import { Icon, pointOf } from "./parts.tsx";

type Page = PageRow & { subtitle?: string; blurb?: string };

/** "Client at Brooks Logistics" says the organisation; any other subtitle says none. */
export const orgOf = (p: Page): string | null => { const m = /^[A-Za-z ]+ at (.+)$/.exec(p.subtitle ?? ""); return m ? m[1]! : null; };

export function KnowList({ kind }: { kind: ListKind }): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const doing = useDoing();
  const pq = useLive("memory.page.list", { kind });
  const fq = useLive("memory.facts.list", { status: ["current"] });
  const tq = useLive("memory.trash.search", { area: "trash" });
  const pages = (pq.status === "ready" ? pq.data.pages : []) as Page[];
  const facts = (fq.status === "ready" ? fq.data.facts : []) as KFact[];
  const trashed = (tq.status === "ready" ? tq.data.facts : []) as KFact[];
  const failed = readError(pq, "Could not read the pages");

  const stats = (id: string): { n: number; trash: number; last: number } => {
    const mine = facts.filter((f) => f.subject?.pageId === id);
    return { n: mine.length, trash: trashed.filter((f) => f.subject?.pageId === id).length, last: Math.max(0, ...each(mine, (f) => f.learnedAt)) };
  };
  const rows = each(pages, (p) => ({ p, ...stats(p.pageId) })).sort((a, b) => (b.last || b.p.updatedAt) - (a.last || a.p.updatedAt));

  const open = (p: Page): void => nav.go({ v: "page", pageId: p.pageId });
  const trash = (p: Page): void => {
    doing.run("Could not move the page to Trash", () => trashPage(data, p.pageId), () => ({
      text: `Moved ${p.title} to Trash.`,
      undo: () => doing.run("Could not restore the page", () => restorePage(data, p.pageId), () => ({ text: `Restored ${p.title}.` })),
    }));
  };
  const entries = (p: Page): MenuEntry[] => [
    { label: "Open", onSelect: () => open(p) }, { label: "Open in Graph", onSelect: () => nav.go({ v: "graph", focus: p.pageId }) },
    { label: "Copy name", onSelect: () => copyText(p.title) }, { separator: true }, { label: "Move to Trash", danger: true, onSelect: () => trash(p) },
  ];

  const title = LIST_TITLE[kind];
  return (
    <View style={frame.main} testID="know-list">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: title }]} />
      <KnowColumn testID="know-list-body" label={title} title={title} lede={LIST_LEDE[kind]}>
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        <View accessibilityRole="list" accessibilityLabel={title} testID="know-list-rows" style={s.list}>
          {each(rows, ({ p, n, trash: t }) => <PageRow key={p.pageId} page={p} facts={n} trash={t} age={p.updatedAt} onOpen={() => open(p)} menu={() => entries(p)} />)}
        </View>
        {rows.length === 0 && pq.status === "ready" ? <Empty title={`No ${title.toLowerCase()} yet`} text="Pages appear here as Vyre learns about them from chats, runs and records." /> : null}
      </KnowColumn>
    </View>
  );
}

function PageRow({ page, facts, trash, onOpen, menu }: { page: Page; facts: number; trash: number; age: number; onOpen: () => void; menu: () => MenuEntry[] }): ReactElement {
  const m = useMenu();
  const org = orgOf(page);
  return (
    <>
      <KRow
        testID={`page-${page.pageId}`} label={page.title} menu={menu} onOpen={onOpen} dot={false}
        main={(
          <View accessibilityRole="link" accessibilityLabel={`Open ${page.title}`} testID={`page-open-${page.pageId}`} {...({ onClick: onOpen } as object)} style={s.pressRow}>
            <SubjectTile name={page.title} kind={page.kind} size={30} />
            <View style={s.names}>
              <Text style={s.name} numberOfLines={1}>{page.title}{org ? <Text style={s.org}>{` · ${org}`}</Text> : null}</Text>
              {page.blurb ? <Text style={s.blurb} numberOfLines={1}>{page.blurb}</Text> : null}
            </View>
            <View style={s.right}>
              <View style={s.badge}><Text style={s.badgeText}>{LAYER_NAME[page.layer]}</Text></View>
              <Text style={s.count} testID={`facts-${page.pageId}`}>{plural(facts, "fact")}</Text>
              {trash > 0 ? <Text style={s.count} testID={`trash-${page.pageId}`}>{`${trash} in Trash`}</Text> : null}
            </View>
          </View>
        )}
        actions={(
          <Pressable accessibilityRole="button" accessibilityLabel={`More for ${page.title}`} testID={`more-${page.pageId}`} onPress={(e) => { const p = pointOf(e); m.show(menu(), p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.more, hovered === true && s.moreOver]}>
            <Icon name="more" size={14} color="var(--ink-2)" />
          </Pressable>
        )}
      />
      {m.element}
    </>
  );
}

const s = StyleSheet.create({
  list: { marginTop: 10 },
  pressRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  names: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "600", lineHeight: 20, color: "var(--ink)" as string },
  org: { fontWeight: "400", color: "var(--ink-3)" as string },
  blurb: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { height: 20, paddingHorizontal: 6, borderRadius: 5, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string },
  badgeText: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  more: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  moreOver: { backgroundColor: "var(--hover)" as string },
});
