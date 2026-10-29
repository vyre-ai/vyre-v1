// Known subjects in message text: the name (or an alias) of a page of Knowledge gets a soft underline; hovering or focusing it opens a card (the tile, the name, what kind of page and who can see it,
// the one-line blurb, the three newest facts, "Open page" and "Open in Graph"); pressing it, or Enter on it, opens the page in Files Knowledge; Escape closes the card. The pages come from one list read
// for the whole thread and are matched in a pure function (model.ts); code and links are never underlined. Without memory the text is drawn as it always was.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import type { RenderLink } from "../../../../../../ui/src/stream/index.ts";
import type { Block } from "../../../../../../ui/src/stream/markdown.ts";
import { KIND_ONE, LAYER_NAME, plural } from "../../files/memory/know.ts";
import type { PageKind } from "../../files/memory/know.ts";
import { each } from "../../files/memory/model.ts";
import { SubjectTile } from "../../files/memory/KnowParts.tsx";
import { useRead } from "./data.tsx";
import { hasSubject, linkSubjects, splitSubjects, subjectKey, subjectOfHref } from "./model.ts";
import type { ChatFact } from "./model.ts";
import { LinkButton, webProps } from "./parts.tsx";
import { useThreadMemory } from "./thread.tsx";

interface PageOut {
  page: { pageId: string; title: string; kind: PageKind; layer: ChatFact["layer"]; blurb?: string; visibleTo?: string; subtitle?: string };
  facts: ChatFact[];
  backlinks: Array<{ kind: string }>;
}

const CARD_W = 290;

/** The blocks of a message with its known subjects as links of their own kind, and the renderer that draws those. `undefined` renderLink when the chat has no memory or no subjects. */
export function useSubjectBlocks(blocks: readonly Block[] | null): { blocks: readonly Block[]; renderLink: RenderLink | undefined } {
  const thread = useThreadMemory();
  const index = thread?.index;
  const linked = useMemo(() => (blocks && index ? linkSubjects(blocks, index) : (blocks ?? [])), [blocks, index]);
  const renderLink = useCallback<RenderLink>((href, children, key) => {
    const pageId = subjectOfHref(href);
    return pageId === null ? null : <Mention key={key} pageId={pageId}>{children}</Mention>;
  }, []);
  return { blocks: linked, renderLink: index && index.re ? renderLink : undefined };
}

/** A plain text (your own bubble) with known subjects underlined; the same text node when there is none. */
export function SubjectText({ text, style }: { text: string; style: object }): ReactElement {
  const thread = useThreadMemory();
  const segs = useMemo(() => (thread ? splitSubjects(text, thread.index) : []), [thread, text]);
  if (!thread || !hasSubject(segs)) return <Text selectable style={style}>{text}</Text>;
  return <Text selectable style={style}>{each(segs, (s, i) => (s.t === "subject" ? <Mention key={i} pageId={s.pageId}>{s.v}</Mention> : s.v))}</Text>;
}

function Mention({ pageId, children }: { pageId: string; children: ReactNode }): ReactElement {
  const thread = useThreadMemory();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [lit, setLit] = useState(false);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef({ word: false, card: false });
  const clear = (): void => { if (wait.current) { clearTimeout(wait.current); wait.current = null; } };
  useEffect(() => clear, []);
  const showAt = (el: unknown): void => {
    const box = (el as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    const w = (globalThis as { innerWidth?: number }).innerWidth ?? 1200;
    if (box) setAt({ left: Math.max(8, Math.min(box.left, w - CARD_W - 8)), top: box.bottom + 6 });
  };
  const closeSoon = (): void => { clear(); wait.current = setTimeout(() => { if (!over.current.word && !over.current.card) setAt(null); }, 200); };
  const open = (): void => { thread?.memory.nav.openPage(pageId); setAt(null); };
  return (
    <>
      <Text
        accessibilityRole="link" accessibilityLabel={`Open the page: ${typeof children === "string" ? children : "subject"}`} testID={`subject-${pageId}`} onPress={open}
        {...webProps({
          tabIndex: 0,
          onMouseEnter: (e: { currentTarget: unknown }) => { over.current.word = true; setLit(true); clear(); const el = e.currentTarget; wait.current = setTimeout(() => showAt(el), 280); },
          onMouseLeave: () => { over.current.word = false; setLit(false); closeSoon(); },
          onFocus: (e: { currentTarget: unknown }) => { setLit(true); showAt(e.currentTarget); },
          onBlur: () => { setLit(false); over.current.word = false; closeSoon(); },
          onKeyDown: (e: { key: string; preventDefault?: () => void }) => {
            const a = subjectKey(e.key);
            if (a === "open") { e.preventDefault?.(); open(); } else if (a === "close") setAt(null);
          },
        })}
        style={[st.word, lit && st.wordLit]}
      >{children}</Text>
      {at ? (
        <SubjectCard pageId={pageId} at={at} onEnter={() => { over.current.card = true; clear(); }} onLeave={() => { over.current.card = false; closeSoon(); }} onClose={() => setAt(null)} />
      ) : null}
    </>
  );
}

/** The hover card of a subject: reads the page when it opens (one read, cached). */
export function SubjectCard({ pageId, at, onEnter, onLeave, onClose }: { pageId: string; at: { left: number; top: number }; onEnter?: () => void; onLeave?: () => void; onClose: () => void }): ReactElement | null {
  const thread = useThreadMemory();
  const read = useRead<PageOut>(thread?.memory.store ?? null, "memory.page.get", thread ? { pageId } : null);
  if (!thread) return null;
  const nav = thread.memory.nav;
  const page = read.status === "ready" ? read.data.page : null;
  const facts = read.status === "ready" ? read.data.facts.slice().sort((a, b) => b.at - a.at).slice(0, 3) : [];
  const chats = read.status === "ready" ? read.data.backlinks.filter((b) => b.kind === "chat").length : 0;
  const name = page?.title ?? thread.pages.find((p) => p.pageId === pageId)?.title ?? "";
  const kind = (page?.kind ?? (thread.pages.find((p) => p.pageId === pageId)?.kind as PageKind | undefined) ?? "topic") as PageKind;
  return (
    <Overlay>
      <View
        testID={`subject-card-${pageId}`} accessibilityRole="none" accessibilityLabel={name}
        {...webProps({ role: "dialog", onMouseEnter: onEnter, onMouseLeave: onLeave, onKeyDown: (e: { key: string }) => { if (e.key === "Escape") onClose(); } })}
        style={[st.card, { left: at.left, top: at.top } as object]}
      >
        <View style={st.head}>
          <SubjectTile name={name} kind={kind} size={28} />
          <View style={st.headText}>
            <Text numberOfLines={1} style={st.name}>{name}</Text>
            <Text numberOfLines={1} style={st.kind}>{`${KIND_ONE[kind] ?? "Page"}${page ? ` · ${LAYER_NAME[page.layer] ?? ""}` : ""}`}</Text>
          </View>
        </View>
        {page?.blurb ? <Text style={st.blurb}>{page.blurb}</Text> : null}
        {read.status === "loading" ? <Text style={st.mute}>Loading</Text> : null}
        {read.status === "ready" && facts.length === 0 ? <Text style={[st.fact, st.mute]}>No facts yet</Text> : null}
        {each(facts, (f) => <Text key={f.factId} testID={`subject-fact-${f.factId}`} style={st.fact}>{f.text}</Text>)}
        <View style={st.foot}>
          <Text style={st.count}>{plural(chats, "chat")} link here</Text>
          <View style={st.acts}>
            <LinkButton label="Open in Graph" testID={`subject-graph-${pageId}`} onPress={() => { nav.openGraph(pageId); onClose(); }} />
            <LinkButton label="Open page" testID={`subject-open-${pageId}`} onPress={() => { nav.openPage(pageId); onClose(); }} />
          </View>
        </View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  word: { textDecorationLine: "underline", textDecorationColor: "color-mix(in srgb, var(--accent) 38%, transparent)", textUnderlineOffset: 3, borderRadius: 2 } as object,
  wordLit: { backgroundColor: "var(--accent-wash)" as string, textDecorationColor: "var(--accent)" as string } as object,
  card: { position: "fixed", width: CARD_W, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 8, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  headText: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  kind: { fontSize: 12, color: "var(--ink-3)" as string },
  blurb: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string, marginBottom: 4 },
  fact: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string, paddingVertical: 3, paddingLeft: 10, marginVertical: 3, borderLeftWidth: 2, borderLeftColor: "var(--line-2)" as string },
  mute: { fontSize: 12.5, color: "var(--ink-4)" as string },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  count: { fontSize: 11.5, color: "var(--ink-4)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
});
