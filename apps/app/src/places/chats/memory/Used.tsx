// Under an agent's reply: "Used 3 memories" (a chevron) that opens into the facts and quotes recalled for that reply, and a card for every exact quote. A fact row has its words, a source chip (a
// press jumps to that moment in the old chat), who and how long ago, Open <page> and a small Forget. A quote row and a quote card show the author, the date, the words in a quote style and
// "Jump to the message". Right-click a row for Open Source, Open Page and Forget This Fact; right-click the line for Show or Hide Memories and Open Knowledge. A reply that used nothing, or a
// server that cannot say, draws nothing at all.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { ageText } from "../../files/memory/know.ts";
import { each } from "../../files/memory/model.ts";
import { Icon } from "../../files/memory/parts.tsx";
import { forgetFacts } from "./actions.ts";
import { useChatMemory, useRead } from "./data.tsx";
import { USED_FOOT, factLine, quoteDate, quoteSub, shapedReply, usedCount, usedLabel } from "./model.ts";
import type { ChatFact, ChatQuote, UsedOut } from "./model.ts";
import { ChipLink, LinkButton, QuoteIcon, glyphOf, sourceLabel, useOpenSource, webProps, ownMenu, ownMenuKeys } from "./parts.tsx";
import { useThreadMemory } from "./thread.tsx";
import { recallable } from "../../../../../../lib/recall-intent.ts";

/** The line, its list and the quote cards of one reply. Draws nothing without memory, while loading, or when the reply used nothing. */
export function ReplyMemory({ messageId, threadId, reply = "", startOpen = false, part = "all" }: { messageId: string; threadId: string; /** the reply's own words: a memory is shown only when it shaped them */ reply?: string; startOpen?: boolean; /** where it draws: the line and its list, the cards of exact quotes, or both */ part?: "all" | "line" | "cards" }): ReactElement | null {
  const mem = useChatMemory();
  const read = useRead<UsedOut>(mem?.store ?? null, "memory.used", mem ? { threadId, messageId } : null);
  if (!mem || read.status !== "ready") return null;
  // what an older reply recorded may include a greeting or an imported session's preamble matched as a quote: those say nothing and are not shown or counted
  // and a fact is shown only when the reply carries it (most replies match some memory a little and are not shaped by it); quotes are only recalled when the person asked to find words
  const used = { ...read.data, quotes: read.data.quotes.filter((q) => recallable(q.text)), facts: read.data.facts.filter((f) => reply === "" || shapedReply(factLine(f), reply)) };
  if (usedCount(used) === 0) return null;
  return (
    <View testID={`used-${messageId}`} style={st.root}>
      {part !== "cards" ? <UsedLine messageId={messageId} used={used} startOpen={startOpen} /> : null}
      {part !== "line" ? each(used.quotes, (q) => <QuoteCard key={q.ref} quote={q} />) : null}
    </View>
  );
}

function UsedLine({ messageId, used, startOpen }: { messageId: string; used: UsedOut; startOpen: boolean }): ReactElement {
  const mem = useChatMemory()!;
  const [open, setOpen] = useState(startOpen);
  const menu = useMenu();
  const n = usedCount(used);
  const entries = (x: number, y: number): void => menu.show([
    { label: open ? "Hide Memories" : "Show Memories", onSelect: () => setOpen((o) => !o) },
    { label: "Open Knowledge", onSelect: () => mem.nav.openKnowledge() },
  ] as MenuEntry[], x, y, "context", { label: "Used memories" });
  return (
    <View testID={`mused-${messageId}`} style={st.mused} {...ownMenu(entries)}>
      <Pressable
        accessibilityRole="button" accessibilityState={{ expanded: open }} aria-expanded={open} accessibilityLabel={`${usedLabel(n)}, ${open ? "hide" : "show"}`} testID={`mused-toggle-${messageId}`} onPress={() => setOpen((o) => !o)}
        style={({ hovered }: { hovered?: boolean }) => [st.head, hovered === true && st.headOver]}
      >
        <Icon name="bulb" size={13} color="var(--ink-3)" />
        <Text style={st.headText}>{usedLabel(n)}</Text>
        <View style={open ? st.flip : undefined}><Icon name="chevd" size={9} color="var(--ink-3)" /></View>
      </Pressable>
      {open ? (
        <View testID={`mused-list-${messageId}`} style={st.list}>
          {each(used.facts, (f, i) => <FactRow key={f.factId} fact={f} first={i === 0} />)}
          {each(used.quotes, (q, i) => <QuoteRow key={q.ref} quote={q} first={used.facts.length === 0 && i === 0} />)}
          <Text style={st.foot}>{USED_FOOT}</Text>
        </View>
      ) : null}
      {menu.element}
    </View>
  );
}

function FactRow({ fact, first }: { fact: ChatFact; first: boolean }): ReactElement {
  const mem = useChatMemory()!;
  const thread = useThreadMemory();
  const menu = useMenu();
  const openSource = useOpenSource();
  const say = (text: string, undo?: () => void | Promise<unknown>): void => thread?.flash(text, undo);
  const forget = (): void => void forgetFacts(mem, [fact.factId], say);
  const items = (x: number, y: number): void => menu.show([
    { label: "Open Source", onSelect: () => openSource(fact) },
    ...(fact.subject ? [{ label: "Open Page", onSelect: () => mem.nav.openPage(fact.subject!.pageId) } as MenuEntry] : []),
    { separator: true },
    { label: "Forget This Fact", danger: true, onSelect: forget },
  ], x, y, "context", { label: factLine(fact) });
  return (
    <View testID={`mused-fact-${fact.factId}`} accessibilityLabel={factLine(fact)} {...webProps({ tabIndex: 0 })} {...ownMenu(items)} style={[st.item, !first && st.itemRule]}>
      <Text style={st.kind}>Fact</Text>
      <View style={st.body}>
        <Text selectable style={st.text}>{factLine(fact)}</Text>
        <View style={st.sub}>
          <ChipLink icon={glyphOf(fact.sourceKind)} label={sourceLabel(fact)} testID={`mused-src-${fact.factId}`} onPress={() => openSource(fact)} />
          <Text style={st.meta}>{`${fact.by ? `${fact.by === mem.me.id ? "you" : mem.nameOf(fact.by)} · ` : ""}${ageText(fact.at, mem.now())}`}</Text>
          {fact.subject ? <LinkButton label={`Open ${fact.subject.title}`} testID={`mused-page-${fact.factId}`} onPress={() => mem.nav.openPage(fact.subject!.pageId)} /> : null}
          <LinkButton label="Forget" quiet testID={`mused-forget-${fact.factId}`} a11y={`Forget this fact: ${factLine(fact)}`} onPress={forget} />
        </View>
      </View>
      {menu.element}
    </View>
  );
}

function QuoteRow({ quote, first }: { quote: ChatQuote; first: boolean }): ReactElement {
  const mem = useChatMemory()!;
  const menu = useMenu();
  const items = (x: number, y: number): void => menu.show([
    { label: "Jump to the Message", onSelect: () => mem.nav.openLink(quote.link) },
    { label: "Copy the Quote", onSelect: () => copy(quote.text) },
  ], x, y, "context", { label: "Quote" });
  return (
    <View testID={`mused-quote-${quote.ref}`} accessibilityLabel={`Quote from ${quote.author.name}`} {...webProps({ tabIndex: 0 })} {...ownMenu(items)} style={[st.item, !first && st.itemRule]}>
      <Text style={st.kind}>Quote</Text>
      <View style={st.body}>
        <Text selectable style={st.text}>{`“${quote.text}”`}</Text>
        <View style={st.sub}>
          <ChipLink icon="chat" label={quote.threadTitle} testID={`mused-qsrc-${quote.ref}`} onPress={() => mem.nav.openLink(quote.link)} />
          <Text style={st.meta}>{`${quote.author.name} · ${quoteDate(quote.at, mem.now())}`}</Text>
        </View>
      </View>
      {menu.element}
    </View>
  );
}

/** An exact quote as a card: the author, the date and chat, the words in a quote style, and a way to the message. Pressing it (or Enter on it) opens the chat at that line. */
export function QuoteCard({ quote }: { quote: ChatQuote }): ReactElement {
  const mem = useChatMemory()!;
  const menu = useMenu();
  const open = (): void => mem.nav.openLink(quote.link);
  const items = (x: number, y: number): void => menu.show([
    { label: "Jump to the Message", onSelect: open },
    { label: "Copy the Quote", onSelect: () => copy(quote.text) },
  ], x, y, "context", { label: "Quote" });
  return (
    <View
      testID={`qcard-${quote.ref}`} accessibilityRole="link" accessibilityLabel={`Quote from ${quote.author.name}, ${quoteSub(quote, mem.now())}. Jump to the message`}
      {...webProps({ tabIndex: 0 })} {...ownMenuKeys(items, (e) => { if (e.key === "Enter") { e.preventDefault?.(); open(); } })}
      style={st.card}
    >
      <View style={st.cardHead}>
        <QuoteIcon />
        <Text style={st.cardWho}>{quote.author.name}</Text>
        <Text style={st.cardWhen}>{quoteSub(quote, mem.now())}</Text>
      </View>
      <Text selectable style={st.cardText}>{`“${quote.text}”`}</Text>
      <View style={st.cardFoot}>
        <ChipLink icon="jump" label="Jump to the message" a11y="Jump to the message" testID={`qcard-jump-${quote.ref}`} onPress={open} />
        <Text style={st.cardNote}>Exact words, recalled from the chat</Text>
      </View>
      {menu.element}
    </View>
  );
}

function copy(text: string): void {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (clip) void clip.writeText(text);
}

const st = StyleSheet.create({
  root: { alignSelf: "stretch" },
  mused: { marginTop: 6, marginBottom: 4, alignItems: "flex-start" },
  head: { height: 24, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, paddingRight: 6, marginLeft: -4, borderRadius: 6 },
  headOver: { backgroundColor: "var(--hover)" as string },
  headText: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  flip: { transform: [{ rotate: "180deg" }] },
  list: { alignSelf: "stretch", marginTop: 4, marginBottom: 2, paddingTop: 4, paddingHorizontal: 12, paddingBottom: 8, borderRadius: 12, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  item: { flexDirection: "row", columnGap: 8, paddingVertical: 9 },
  itemRule: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  kind: { width: 46, fontSize: 11, fontWeight: "600", color: "var(--ink-3)" as string, paddingTop: 3 },
  body: { flex: 1, minWidth: 0 },
  text: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  sub: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2, marginTop: 3 },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  foot: { paddingTop: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string, fontSize: 11.5, color: "var(--ink-4)" as string },
  card: { marginTop: 10, marginBottom: 4, maxWidth: 560, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderLeftWidth: 3, borderLeftColor: "var(--accent)" as string, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line-2)" } as object,
  cardHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardWho: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  cardWhen: { fontSize: 12.5, color: "var(--ink-3)" as string },
  cardText: { marginTop: 8, marginBottom: 10, fontSize: 14.5, lineHeight: 22, color: "var(--ink)" as string },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardNote: { fontSize: 12, color: "var(--ink-4)" as string },
});
