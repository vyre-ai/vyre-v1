// /btw: a side question and its answer, as a quiet card that floats just above the composer. One header line (a lock for "only you see this", the question, Keep, close), the answer a step smaller
// below it. It is not part of the conversation: the agent working in the chat does not see it unless the person presses Keep, which posts the answer into the chat as one card and takes the card away.
// It floats over the foot of the transcript (zero height in the layout), so it never moves the conversation. Esc closes it and the cursor goes back to the composer. On a phone it is a bottom sheet.
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StreamText, createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import { Glyph, IconButton } from "./parts.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { ActivityLine } from "./ActivityLine.tsx";
import { RefStreamText } from "./ref-chips.tsx";
import { useConversationData } from "./data.tsx";
import * as act from "./actions.ts";

export interface AsideItem { id: string; question: string }

const NO_TURNS: readonly never[] = [];
const noSub = (): (() => void) => () => undefined;

/** The saved answer of an aside's thread, read until it is there (the live words are shown meanwhile, and are all there is when no live link carries them). */
function useAnswer(threadId: string): string | null {
  const data = useConversationData();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (n: number): void => {
      void data.call("chat.messages.list", { threadId, limit: 20 }).then((r) => {
        if (!live) return;
        const msgs = (r as { messages?: Array<{ author: { kind: string }; body: string }> }).messages ?? [];
        const a = [...msgs].reverse().find((m) => m.author.kind === "agent" && m.body.trim() !== "");
        if (a) setText(a.body.trim());
        else if (n < 150) timer = setTimeout(() => look(n + 1), 800);
      }, () => { if (live && n < 150) timer = setTimeout(() => look(n + 1), 1500); });
    };
    look(0);
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [data, threadId]);
  return text;
}

const CSS = [
  "@keyframes vyre-aside-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
  "@keyframes vyre-aside-out{to{opacity:0;transform:translateY(6px)}}",
  "[data-vyre-aside]{animation:vyre-aside-in 180ms cubic-bezier(.2,.8,.2,1) both}",
  "[data-vyre-aside=out]{animation:vyre-aside-out 140ms ease-in both}",
  "@media (prefers-reduced-motion:reduce){[data-vyre-aside]{animation:none!important}}",
].join("\n");
const web = Platform.OS === "web";
const ensureCss = (): void => { if (web) injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-aside", CSS); };

/** The lock: one glyph whose tooltip says who sees this. A plain element on the web so the browser's own tooltip shows; elsewhere the glyph with its label. */
function Lock({ id }: { id: string }): ReactElement {
  if (web) return createElement("span", { "data-testid": `aside-lock-${id}`, title: "Only you see this", "aria-label": "Only you see this", role: "img", style: { width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "default" } }, createElement("svg", { viewBox: "0 0 16 16", width: 13, height: 13, "aria-hidden": true, style: { display: "block", fill: "none", stroke: "var(--ink-3)", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } }, createElement("path", { d: "M4.5 7.5h7v5.5h-7z" }), createElement("path", { d: "M6 7.5V5.8a2 2 0 014 0v1.7" })));
  return <View testID={`aside-lock-${id}`} accessible accessibilityLabel="Only you see this" style={st.lock}><Glyph name="lock" size={13} color="var(--ink-3)" /></View>;
}

/** The composer's field, so closing the card hands the cursor back to where the person was typing. */
function focusComposer(): void {
  const doc = (globalThis as { document?: { querySelector(q: string): { focus?: () => void } | null } }).document;
  doc?.querySelector('[data-testid="composer-field"]')?.focus?.();
}

export function AsideCard({ item, onDismiss, sheet = false }: { item: AsideItem; onDismiss: (id: string) => void; sheet?: boolean }): ReactElement {
  ensureCss();
  const data = useConversationData();
  const live = data.live;
  const turns = useSyncExternalStore(live ? live.subscribe : noSub, () => (live ? live.turnsOf(item.id) : NO_TURNS), () => (live ? live.turnsOf(item.id) : NO_TURNS));
  const turn = turns[0];
  const writing: StreamStore | undefined = turn ? data.streamOf(turn.messageId ?? `turn:${turn.turnId}`) : undefined;
  const saved = useAnswer(item.id);
  const done = useMemo<StreamStore | null>(() => {
    if (saved === null) return null;
    const s = createStreamStore();
    s.push(saved);
    s.end();
    return s;
  }, [saved]);
  const [kept, setKept] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [overflow, setOverflow] = useState(false);
  const store = writing && !(writing.getSnapshot().done && done) ? writing : done;
  const answered = saved !== null;
  const height = useWindowDimensions().height;
  const maxAnswer = Math.max(120, Math.min(360, Math.round(height * 0.4)));
  const leave = (then: () => void): void => { setLeaving(true); setTimeout(then, web ? 140 : 0); };
  const keep = (): void => {
    if (kept) return;
    setKept(true);
    void act.keepAside(data, item.id, data.newKey()).then(
      () => { setTimeout(() => leave(() => onDismiss(item.id)), 900); },
      () => { setKept(false); setProblem("Could not keep it."); },
    );
  };
  const dismiss = (): void => { void act.dismissAside(data, item.id); leave(() => onDismiss(item.id)); focusComposer(); };
  // Esc closes the card and the cursor goes back to the composer
  const dismissRef = useRef(dismiss); dismissRef.current = dismiss;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: { key: string; defaultPrevented?: boolean }) => void): void; removeEventListener(t: string, f: (e: { key: string; defaultPrevented?: boolean }) => void): void } }).document;
    if (!doc) return undefined;
    const on = (e: { key: string; defaultPrevented?: boolean }): void => { if (e.key === "Escape" && !e.defaultPrevented) dismissRef.current(); };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  }, []);
  const activity = !answered && turn ? data.activityOf?.(turn.messageId ?? `turn:${turn.turnId}`) : undefined;
  return (
    <View testID={`aside-${item.id}`} accessibilityRole="summary" accessibilityLabel="Side question" style={[st.card, sheet && st.sheet]} {...(web ? { dataSet: { vyreAside: leaving ? "out" : "in" } } : {})}>
      {sheet ? <View style={st.grab} /> : null}
      <View style={st.head}>
        <Lock id={item.id} />
        <Text numberOfLines={1} testID={`aside-question-${item.id}`} style={st.question}>{item.question}</Text>
        {kept ? <View testID={`aside-kept-${item.id}`} style={st.keptNote}><Glyph name="check" size={13} color="var(--ok)" /><Text style={st.keptText}>Kept</Text></View> : null}
        {answered && !kept ? <IconButton icon="pin" label="Keep in this chat" size={sheet ? 34 : 26} testID={`aside-keep-${item.id}`} onPress={keep} /> : null}
        <IconButton icon="x" label="Close" size={sheet ? 34 : 26} testID={`aside-dismiss-${item.id}`} onPress={dismiss} />
      </View>
      <View testID={`aside-answer-${item.id}`} style={st.answer}>
        {activity ? <ActivityLine store={activity} /> : !store ? <View style={st.thinkingRow}><WorkingMark state="thinking" size={16} /><Text style={st.thinking}>Thinking</Text></View> : null}
        {store ? (
          <ScrollView style={[{ maxHeight: maxAnswer }, web && overflow ? ({ maskImage: "linear-gradient(to bottom,#000 calc(100% - 22px),transparent)", WebkitMaskImage: "linear-gradient(to bottom,#000 calc(100% - 22px),transparent)" } as object) : null]}
            onContentSizeChange={(_w, h) => setOverflow(h > maxAnswer + 2)} showsVerticalScrollIndicator={false}>
            <View style={web ? ({ zoom: 0.92 } as object) : undefined}><RefStreamText store={store} data={data} /></View>
          </ScrollView>
        ) : null}
      </View>
      {problem !== "" ? <Text style={st.problem}>{problem}</Text> : null}
    </View>
  );
}

/** The aside of this chat, above the composer. A new /btw replaces the one before it. */
export function AsideList({ items, onDismiss }: { items: readonly AsideItem[]; onDismiss: (id: string) => void }): ReactElement | null {
  const data = useConversationData();
  const { width } = useWindowDimensions();
  const newest = items[items.length - 1];
  const stale = items.slice(0, -1).map((x) => x.id).join(",");
  useEffect(() => {
    if (stale === "") return;
    for (const id of stale.split(",")) { void act.dismissAside(data, id); onDismiss(id); }
  }, [stale]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!newest) return null;
  const phone = width <= 520;
  // zero height in the layout: the card floats up from the composer over the foot of the transcript, so the conversation never moves
  return (
    <View testID="asides" style={st.anchor} pointerEvents="box-none">
      <View style={[st.float, phone ? st.floatPhone : null]} pointerEvents="box-none"><AsideCard key={newest.id} item={newest} onDismiss={onDismiss} sheet={phone} /></View>
    </View>
  );
}

const st = StyleSheet.create({
  anchor: { height: 0, position: "relative", zIndex: 5, overflow: "visible" },
  float: { position: "absolute", left: 0, right: 0, bottom: 6, alignItems: "center", paddingHorizontal: 24 },
  floatPhone: { bottom: 0, paddingHorizontal: 0 },
  card: { width: "100%", maxWidth: 760, borderRadius: 16, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10, gap: 4, backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line-2), 0 1px 2px rgba(0,0,0,.06), 0 12px 32px -12px rgba(0,0,0,.28)", backgroundImage: "linear-gradient(var(--accent-wash), var(--accent-wash))" } as object,
  sheet: { maxWidth: 9999, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 14 },
  grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string, marginTop: 2, marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30 },
  lock: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  question: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-3)" as string },
  keptNote: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 },
  keptText: { fontSize: 12, color: "var(--ink-2)" as string },
  answer: { minHeight: 22, paddingHorizontal: 4, paddingTop: 2 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  thinking: { fontSize: 13, color: "var(--ink-3)" as string },
  problem: { fontSize: 12, color: "var(--danger)" as string, paddingHorizontal: 4 },
});
