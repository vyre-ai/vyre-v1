// The one Ask pane (owner rule, rc.17): the compact chat of Chats, docked beside the place on ASK_SIDE, about the thing the person asked about. Its bar holds the agent dropdown (the person's
// Assistant first), New and Open in Chats; under it the chip of the thing, with an x that makes it about the place again. The composer is the Chats composer, so the model picker and the
// focus skill come with it, and every message carries the pane's screen context (the thing as the open object, the place's focus skill, what the door added). Escape closes it. The width is
// remembered per place by the shared SidePane. Nothing here navigates except Open in Chats, which is the person asking for the full chat.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SidePane } from "../../../../../ui/src/SidePane/index.tsx";
import { ResizableColumn } from "../../../../../ui/src/SidePane/resize.tsx";
import { MenuIcon, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { isAssistantRow } from "../../../../../lib/agent-kind.ts";
import { createComposerFill } from "../../places/chats/conversation/data.tsx";
import { TextButton } from "../../places/chats/conversation/parts.tsx";
import { conversationData } from "../providers/chats-data.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { currentScreen, noteThreadKind, pinThreadScreen } from "./screen.ts";
import type { ScreenContext } from "./screen.ts";
import { ASK_SIDE, askChip, askLine, askPaneKey, askScreen, closeAskPane, dropAskThing, newAsk, switchAskAgent, threadKey } from "./pane.ts";
import type { AskPaneState } from "./pane.ts";
import { openAskInChats, resolveAskThread } from "./thread.ts";

const ChatsConversation = lazy(() => import("../providers/chats.tsx").then((m) => ({ default: m.ChatsConversation })));

/** What a message sent in the pane carries: where the person is in the place (rows, a selection), with the pane's thing and context on top. Without a thing nothing names an open object. */
export function paneScreen(state: AskPaneState, here: ScreenContext | null = currentScreen()): ScreenContext {
  const base = here && here.place === state.place ? here : { place: state.place };
  const mine = askScreen(state);
  const merged: ScreenContext = { ...base, ...mine };
  if (!state.thing) delete merged.open;
  return merged;
}

interface AgentChoice { id: string; name: string }

/** The agents this person may ask: their own Assistant first, then every other agent; another person's Assistant is theirs alone and never offered. */
function useAgents(rt: ShellRuntime): readonly AgentChoice[] {
  const [list, setList] = useState<readonly AgentChoice[]>([{ id: rt.assistant.id, name: rt.assistant.name }]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("agents.list", {})).then((o) => {
      const rows = (o as { agents?: { agentId: string; name: string; kind?: string; role?: string; ownerId?: string }[] } | null)?.agents ?? [];
      const others = rows.filter((a) => a.agentId !== rt.assistant.id && !(isAssistantRow(a) && a.ownerId !== rt.me.id)).map((a) => ({ id: a.agentId, name: a.name }));
      if (live) setList([{ id: rt.assistant.id, name: rt.assistant.name }, ...others]);
    }, () => undefined);
    return () => { live = false; };
  }, [rt]);
  return list;
}

export function AskPane({ rt, state }: { rt: ShellRuntime; state: AskPaneState }): ReactElement {
  const place = state.place;
  const close = (): void => closeAskPane(place);
  const agentId = state.agentId === "assistant" ? rt.assistant.id : state.agentId;
  const agents = useAgents(rt);
  const agentName = agents.find((a) => a.id === agentId)?.name ?? (agentId === rt.assistant.id ? rt.assistant.name : "Agent");
  const menu = useMenu();
  const [thread, setThread] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fill = useRef(createComposerFill());
  const key = threadKey({ ...state, agentId });
  // the thread for this thing with this agent: the newest of the person's own, else a new one; New and another agent find another
  useEffect(() => {
    let live = true;
    setThread(null);
    setFailed(false);
    void resolveAskThread(rt.call, state, agentId).then((id) => {
      if (!live) return;
      if (id === null) { setFailed(true); return; }
      noteThreadKind(id, "ask");
      setThread(id);
    });
    return () => { live = false; };
  }, [rt, key]);   // eslint-disable-line react-hooks/exhaustive-deps -- the key is what the thread depends on
  // the screen context every message in the pane carries, read at send time
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (thread === null) return undefined;
    pinThreadScreen(thread, () => paneScreen(latest.current));
    return () => pinThreadScreen(thread, null);
  }, [thread]);
  // a door's draft lands in the composer once the thread is open; the person sends it
  useEffect(() => { if (thread !== null && state.draft) fill.current.set(state.draft); }, [thread, state.draft, state.seq]);
  // Escape closes the pane: pressed inside it (unless something in it, a menu or the composer's list, took the key first), or with nothing focused on the page
  const onEsc = (e: KeyLike): void => {
    if (e.key !== "Escape" || e.defaultPrevented === true) return;
    e.preventDefault?.();
    close();
  };
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: KeyLike) => void) => void; removeEventListener?: (t: string, f: (e: KeyLike) => void) => void; document?: { activeElement?: unknown; body?: unknown } };
    const onKey = (e: KeyLike): void => {
      const active = g.document?.activeElement;
      if (active === undefined || active === null || active === g.document?.body) onEsc(e);
    };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, [place]);   // eslint-disable-line react-hooks/exhaustive-deps -- close reads only the place
  const data = useMemo(() => {
    if (thread === null) return null;
    const people = rt.principals.getSnapshot();
    return conversationData(rt, { openThread: (id) => rt.open({ subject: { type: "thread", id } }), togglePane: () => undefined, fillComposer: () => undefined, openAgentChat: (id) => rt.open({ subject: { type: "agent", id } }) }, thread, people.status === "ready" ? people.data : [], fill.current);
  }, [rt, thread]);
  const pickAgent = (x: number, y: number): void => {
    const items: MenuEntry[] = [{ head: "Ask" }, ...agents.map((a): MenuEntry => ({ label: a.name, checked: a.id === agentId, onSelect: () => switchAskAgent(place, a.id === rt.assistant.id ? "assistant" : a.id) }))];
    menu.show(items, x, y, "other", { label: "Ask Vyre" });
  };
  const chip = askChip(state.thing);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < PHONE_W;
  const body = (
    <View style={st.body} testID="ask-pane" accessibilityLabel={chip ? `Ask Vyre about ${chip}` : "Ask Vyre"} {...(Platform.OS === "web" ? { dataSet: { askPlace: place, askThread: thread ?? "" }, onKeyDown: onEsc } : {})}>
      <View style={st.bar} testID="ask-pane-bar">
        <Pressable
          accessibilityRole="button" accessibilityLabel={`Ask ${agentName}. Change agent`} testID="ask-pane-agent"
          onPress={(e) => { const n = (e as unknown as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent; pickAgent(n?.pageX ?? 0, (n?.pageY ?? 0) + 8); }}
          style={({ hovered }: { hovered?: boolean }) => [st.agent, hovered === true && st.agentOver]}
        >
          <Text numberOfLines={1} style={st.agentText} testID="ask-pane-agent-name">{agentName}</Text>
          <MenuIcon icon={CHEVRON} color="var(--ink-3)" size={10} />
        </Pressable>
        <View style={st.grow} />
        <TextButton label="New" icon="plus" testID="ask-pane-new" onPress={() => newAsk(place)} />
        <TextButton label="Open in Chats" testID="ask-pane-open-chats" disabled={thread === null} onPress={() => { if (thread !== null) void openAskInChats(rt.call, (t) => rt.open(t), thread).then(close, () => setFailed(true)); }} />
        {phone ? <TextButton label="Close" icon="x" testID="ask-pane-close" onPress={close} /> : null}
      </View>
      {chip ? (
        <View style={st.chipRow}>
          <View style={st.chip} testID="ask-pane-chip" accessibilityLabel={`About ${chip}`}>
            <Text numberOfLines={1} style={st.chipText}>{chip}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Ask about all of this place, not ${chip}`} testID="ask-pane-chip-remove" onPress={() => dropAskThing(place)} style={({ hovered }: { hovered?: boolean }) => [st.chipX, hovered === true && st.agentOver]}>
              <MenuIcon icon="x" color="var(--ink-3)" size={12} />
            </Pressable>
          </View>
        </View>
      ) : null}
      <Text style={st.hint} testID="ask-pane-hint">{askLine(state)}</Text>
      <View style={st.chat} testID="ask-pane-chat">
        {failed ? <Text testID="ask-pane-error" style={st.wait}>I could not open the assistant here. Check your AI account, or that you can see this.</Text>
          : data ? <Suspense fallback={null}><ChatsConversation key={thread ?? ""} data={data} compact /></Suspense>
          : <Text style={st.wait} testID="ask-pane-opening">{`Opening ${agentName}`}</Text>}
      </View>
      {menu.element}
    </View>
  );
  // a phone has no room beside the place: the pane covers it, and Close (or Escape) gives it back as it was
  if (phone) return <View style={st.phone} testID="side-pane">{body}</View>;
  if (ASK_SIDE === "left") {
    return <ResizableColumn paneKey={askPaneKey(place)} defaultWidth={380} grow="right" min={300} inline style={st.left as never} testID="side-pane">{body}</ResizableColumn>;
  }
  return <SidePane paneKey={askPaneKey(place)} toggle={{ open: true, onPress: close }} title="Ask Vyre" defaultWidth={380} min={300}>{body}</SidePane>;
}

const PHONE_W = 720;

interface KeyLike { key: string; defaultPrevented?: boolean; preventDefault?: () => void }

const CHEVRON = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

const st = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  agent: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, borderRadius: 7, maxWidth: 180 },
  agentOver: { backgroundColor: "var(--hover)" as string },
  agentText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  grow: { flex: 1 },
  chipRow: { flexDirection: "row", paddingHorizontal: 12, paddingTop: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", height: 24, paddingLeft: 9, paddingRight: 3, borderRadius: 12, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string, flexShrink: 1 },
  chipX: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  chat: { flex: 1, minHeight: 0 },
  wait: { fontSize: 13, color: "var(--ink-3)" as string, padding: 12 },
  phone: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: "var(--win)" as string },
  left: { borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
});
