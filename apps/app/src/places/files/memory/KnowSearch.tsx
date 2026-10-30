// Files > Knowledge > Search: ask in plain words or type a name. The Search knowledge field in the header drives `q`. With nothing typed the screen offers three example questions (a press runs one).
// With a question: Pages (names that match), Facts (each with its subject, text, source chip, who and when, and whether the words or the meaning found it), and "In Trash, not recalled by agents" with
// Restore. A line under the title says whether meaning search is on (it matches meaning and words on this server) or that only the words were matched, and why, in plain words. A press opens the page
// with the fact highlighted. Right-click on a fact: Open page, Open source, Copy fact.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { restoreFact, undoFact } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import { Flash, KnowColumn, KnowHeader, SectionHead, frame } from "./KnowFrame.tsx";
import { ErrorLine, FactRow, KRow, TrashRow, copyText, openSourceOf, readError, removedBy, useDoing, useLiveSafe, whoOf } from "./KnowRows.tsx";
import { SubjectTile } from "./KnowParts.tsx";
import { KIND_ONE, ageText } from "./know.ts";
import type { KFact, PageRow } from "./know.ts";
import { each } from "./model.ts";
import { Icon } from "./parts.tsx";

export const EXAMPLE_QUESTIONS: readonly string[] = ["How does Ian like to hear from us?", "What do we charge for a first consult?", "When does Maya take consults?"];

type Meaning = { state: "on" | "loading" | "not_set_up" | "degraded" | "off"; model?: string; hint?: string };
/** The line that says how the answer was found, in plain words. */
export function meaningLine(m: Meaning | undefined): string | null {
  if (!m) return null;
  switch (m.state) {
    case "on": return "Matching meaning and words on this server.";
    case "loading": return m.hint ?? "Meaning search is getting ready. These are keyword matches for now.";
    case "not_set_up": return m.hint ?? "Meaning search is not set up on this server yet. These are keyword matches.";
    case "degraded": return m.hint ?? "Meaning search is having trouble right now. These are keyword matches.";
    case "off": return m.hint ?? "Meaning search is off for this Space. These are keyword matches.";
  }
}

type Page = PageRow & { blurb?: string };
type Hit = { kind: string; factId?: string; pageId?: string; title: string; text: string; sourceLink?: string; by?: string };

export function KnowSearch({ q }: { q: string }): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const now = data.now();
  const who = whoOf(data);
  const doing = useDoing();
  const term = q.trim();
  const none = term === "";
  const pq = useLiveSafe("memory.page.list", { q: term }, none);
  const sq = useLiveSafe("memory.search", { q: term, limit: 12 }, none);
  const tq = useLiveSafe("memory.trash.search", { q: term }, none);
  const fq = useLive("memory.facts.list", { status: ["current"] });
  const trq = useLiveSafe("memory.trail", { limit: 500 }, none);
  const pages = ((pq.status === "ready" ? pq.data.pages : []) as Page[]).slice(0, 4);
  const hits = (sq.status === "ready" ? sq.data.hits : []).filter((h) => h.kind === "fact") as Hit[];
  const facts = (fq.status === "ready" ? fq.data.facts : []) as KFact[];
  const inTrash = ((tq.status === "ready" ? tq.data.facts : []) as KFact[]).slice(0, 3);
  const trail = trq.status === "ready" ? trq.data.rows : [];
  const meaning = sq.status === "ready" ? meaningLine(sq.data.meaning) : null;
  const failed = none ? null : readError(sq, "Could not search");

  const go = (text: string): void => nav.go({ v: "search", q: text });
  const restore = (f: KFact): void => {
    doing.run("Could not restore the fact", () => restoreFact(data, f.factId), () => ({
      text: "Restored.",
      undo: () => doing.run("Could not move the fact back to Trash", () => undoFact(data, f.factId), () => ({ text: "Moved back to Trash." })),
    }));
  };
  const openFact = (f: KFact): void => { if (f.subject) nav.go({ v: "page", pageId: f.subject.pageId, hl: f.factId }); };
  const factMenu = (f: KFact): MenuEntry[] => [
    ...(f.subject ? [{ label: "Open page", onSelect: () => openFact(f) }] : []), { label: "Open source", onSelect: () => openSourceOf(nav, f) }, { label: "Copy fact", onSelect: () => copyText(f.text) },
  ];

  const factRows: ReactElement[] = [];
  for (const h of hits) {
    const f = facts.find((x) => x.factId === h.factId);
    if (!f) continue;
    const tag = h.by === "meaning" ? <Text key="tag" style={[s.meta, s.mean]}>Matched by meaning</Text> : h.by === "words" ? <Text key="tag" style={s.meta}>Matched by words</Text> : null;
    factRows.push(
      <FactRow
        key={f.factId} fact={f} testID={`hit-${f.factId}`} menu={() => factMenu(f)} onOpen={() => openFact(f)}
        meta={[...(f.by ? [who(f.by)] : []), ageText(f.learnedAt, now), ...(tag ? [tag] : [])]}
      />,
    );
  }

  return (
    <View style={frame.main} testID="know-search">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Search" }]} q={q} focusSearch />
      <KnowColumn testID="know-search-body" label="Search" title="Search" lede="Ask in plain words or type a name. Vyre matches meaning as well as words, on this server, so nothing leaves it.">
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        {none ? (
          <View testID="search-examples">
            <SectionHead title="Try a question" />
            <View style={s.ex}>
              {each(EXAMPLE_QUESTIONS, (x) => (
                <Pressable key={x} accessibilityRole="button" accessibilityLabel={x} testID="search-example" onPress={() => go(x)} style={({ hovered }: { hovered?: boolean }) => [s.exq, hovered === true && s.exqOver]}>
                  <Icon name="find" size={13} color="var(--ink-3)" /><Text style={s.exText}>{x}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <>
            {meaning ? <Text style={s.state} testID="search-meaning">{meaning}</Text> : null}
            {pages.length > 0 ? (
              <View testID="search-pages">
                <SectionHead title="Pages" />
                {each(pages, (p) => (
                  <KRow
                    key={p.pageId} testID={`search-page-${p.pageId}`} label={p.title} dot={false} onOpen={() => nav.go({ v: "page", pageId: p.pageId })}
                    menu={() => [{ label: "Open", onSelect: () => nav.go({ v: "page", pageId: p.pageId }) }, { label: "Open in Graph", onSelect: () => nav.go({ v: "graph", focus: p.pageId }) }, { label: "Copy name", onSelect: () => copyText(p.title) }]}
                    main={(
                      <View accessibilityRole="link" accessibilityLabel={`Open ${p.title}`} {...({ onClick: () => nav.go({ v: "page", pageId: p.pageId }) } as object)} style={s.pageRow}>
                        <SubjectTile name={p.title} kind={p.kind} size={26} />
                        <View style={s.grow}><Text style={s.name}>{p.title}</Text>{p.blurb ? <Text style={s.blurb} numberOfLines={1}>{p.blurb}</Text> : null}</View>
                        <View style={s.badge}><Text style={s.badgeText}>{KIND_ONE[p.kind]}</Text></View>
                      </View>
                    )}
                  />
                ))}
              </View>
            ) : null}
            <SectionHead title="Facts" sub={`${factRows.length} found`} testID="search-facts-head" />
            <View accessibilityRole="list" accessibilityLabel="Facts" testID="search-facts">{factRows}</View>
            {factRows.length === 0 && sq.status === "ready" ? <Text style={s.none} testID="search-none">No current facts match. Try other words, or ask it as a question.</Text> : null}
            {inTrash.length > 0 ? (
              <View testID="search-trash">
                <SectionHead title="In Trash" sub="not recalled by agents" />
                {each(inTrash, (f) => (
                  <TrashRow
                    key={f.factId} fact={f} who={who} by={removedBy(trail, f)} now={now} keep={60} archive={false} canRestore onRestore={() => restore(f)} onOpen={() => openFact(f)}
                    menu={() => [{ label: "Restore", onSelect: () => restore(f) }, ...factMenu(f)]}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </KnowColumn>
    </View>
  );
}

const s = StyleSheet.create({
  ex: { marginTop: 8, gap: 4 },
  exq: { flexDirection: "row", alignItems: "center", gap: 10, height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--hover)" as string },
  exqOver: { backgroundColor: "var(--sunk)" as string },
  exText: { fontSize: 14, color: "var(--ink-2)" as string },
  state: { marginTop: 12, fontSize: 12.5, color: "var(--ink-3)" as string },
  pageRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "600", lineHeight: 20, color: "var(--ink)" as string },
  blurb: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  badge: { height: 20, paddingHorizontal: 6, borderRadius: 5, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string },
  badgeText: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string },
  mean: { color: "var(--accent)" as string, fontWeight: "500" },
  none: { marginTop: 8, fontSize: 13, color: "var(--ink-3)" as string },
});
