// An imported coding session opened in Chats: the saved transcript, read-only, drawn with the same pieces as a chat (your turns as bubbles, the assistant's with a face, markdown body
// and its tool calls folded under it). One action, Continue here, starts (or reopens) a real chat that carries the transcript, through sessions.continue; the archive is never written.
// The title is a button that renames it, as a chat's header does (sessions.rename): only the name shown changes, never the transcript.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MarkdownBlocks } from "../../../../../../ui/src/stream/index.ts";
import { Mark } from "../../../onboarding/ProviderLogo.tsx";
import { Face } from "../needsyou/parts.tsx";
import { Fold, RenameField, TextButton } from "../conversation/parts.tsx";
import { st } from "../conversation/MessageView.tsx";
import { bodyBlocks, collect } from "../conversation/model.ts";
import { continueImported } from "./continue.ts";
import { importedChanged, onImportedChange } from "./changes.ts";
import { headerLine, importedItems, providerMark, providerName } from "./model.ts";
import type { ImportedItem, ImportedMessage } from "./model.ts";

export interface ImportedData {
  call(cap: string, input: unknown): Promise<unknown>;
  clock(): { now: number; offsetMin: number };
  /** The Space the archive lives in and the assistant that carries the transcript on. */
  spaceId: string;
  assistantId: string;
  /** A live chat opens in the place. */
  openChat(threadId: string): void;
}

interface Session { conversationId: string; provider: string; title: string; startedAt: number; continuedThreadId?: string }
type Loaded = { status: "loading" } | { status: "error"; text: string } | { status: "ready"; session: Session; messages: ImportedMessage[] };

function Turn({ item, provider, conversationId }: { item: ImportedItem; provider: string; conversationId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const blocks = useMemo(() => (item.kind === "other" && item.text !== "" ? bodyBlocks(`${conversationId}:${item.key}`, item.text) : null), [item, conversationId]);
  if (item.kind === "me") {
    return (
      <View testID={`imported-msg-${item.key}`} accessibilityLabel="You" style={[st.me, st.gapTop]}>
        {item.text.trim() === "" ? null : <View style={st.bubble}><Text selectable style={st.bubbleText}>{item.text}</Text></View>}
      </View>
    );
  }
  return (
    <View testID={`imported-msg-${item.key}`} accessibilityLabel={providerName(provider)} style={[st.msg, st.gapTop]}>
      <View style={st.by}><Face name={providerName(provider)} seedId={conversationId} kind="agent" size={20} /><Text style={st.who}>{providerName(provider)}</Text></View>
      {blocks ? <View style={st.body}><MarkdownBlocks blocks={blocks} /></View> : null}
      {item.tools.length > 0 ? (
        <Fold testID={`imported-tools-${item.key}`} label={item.toolLabel} open={open} onToggle={() => setOpen((o) => !o)}>
          {collect(item.tools, (t, i) => (
            <View key={t.id ?? i} testID={`imported-tool-${item.key}-${i}`} style={st.step}>
              <View style={st.stepDot} />
              <Text numberOfLines={2} style={st.stepTitle}>{`${t.summary || t.name}${t.ok === false ? " (failed)" : ""}`}</Text>
            </View>
          ))}
        </Fold>
      ) : null}
    </View>
  );
}

export function ImportedSession({ data, conversationId }: { data: ImportedData; conversationId: string }): ReactElement {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  // read again when the sidebar renames or archives it; the page stays drawn while it reads
  const [reread, setReread] = useState(0);
  useEffect(() => onImportedChange(() => setReread((n) => n + 1)), []);
  const loaded = useRef("");
  useEffect(() => {
    let off = false;
    if (loaded.current !== conversationId) setState({ status: "loading" });
    loaded.current = conversationId;
    void (data.call("sessions.get", { conversationId }) as Promise<{ session: Session; messages: ImportedMessage[] }>).then(
      (r) => { if (!off) setState({ status: "ready", session: r.session, messages: r.messages }); },
      (e) => { if (!off) setState({ status: "error", text: e instanceof Error ? e.message : "Could not open this session." }); },
    );
    return () => { off = true; };
  }, [data.call, conversationId, reread]);
  if (state.status === "loading") return <View testID="imported-loading" accessibilityLabel="Loading" style={s.root} />;
  if (state.status === "error") return <View style={s.root}><Text testID="imported-error" accessibilityRole="alert" style={s.err}>{state.text}</Text></View>;
  const { session, messages } = state;
  const clock = data.clock();
  const items = importedItems(messages);
  const rename = (title: string | null): void => {
    setRenaming(false);
    if (title === null) return;
    setState((st0) => (st0.status === "ready" ? { ...st0, session: { ...st0.session, title } } : st0));
    void Promise.resolve().then(() => data.call("sessions.rename", { conversationId, title })).then(() => importedChanged(), () => { setError("Could not rename it."); importedChanged(); });
  };
  const go = (): void => {
    if (busy) return;
    setBusy(true); setError("");
    void continueImported(data, conversationId).then(
      (threadId) => { setBusy(false); data.openChat(threadId); },
      (e) => { setBusy(false); setError(e instanceof Error ? e.message : "That did not work. Try again."); },
    );
  };
  return (
    <View testID="imported-session" style={s.root}>
      <View style={s.head}>
        <View style={s.headText}>
          {renaming ? (
            <RenameField value={session.title} label="Rename this session" testID="imported-rename" style={s.rename} onDone={rename} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${session.title}`} testID="imported-title-button" {...(Platform.OS === "web" ? ({ title: "Rename" } as object) : {})} onPress={() => setRenaming(true)} style={(state) => [s.titleBtn, (state as { hovered?: boolean }).hovered === true && s.titleOver]}>
              <Text accessibilityRole="header" numberOfLines={1} testID="imported-title" style={s.title}>{session.title}</Text>
            </Pressable>
          )}
          <View style={s.source}>
            <Mark k={providerMark(session.provider)} size={14} />
            <Text testID="imported-header" style={s.sub}>{headerLine(session.provider, session.startedAt, clock.now, clock.offsetMin)}</Text>
          </View>
        </View>
        <TextButton primary label="Continue here" disabled={busy} testID="imported-continue" onPress={go} />
      </View>
      {error ? <Text testID="imported-error" accessibilityRole="alert" style={s.err}>{error}</Text> : null}
      <ScrollView style={s.fill} contentContainerStyle={s.scroll}>
        {collect(items, (it) => <Turn key={it.key} item={it} provider={session.provider} conversationId={conversationId} />)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  titleBtn: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: -6 } as object,
  titleOver: { backgroundColor: "var(--hover)" as string },
  rename: { width: 360, maxWidth: "100%", height: 26, borderRadius: 6, paddingHorizontal: 6, marginLeft: -6, fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  source: { flexDirection: "row", alignItems: "center", gap: 6 },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  fill: { flex: 1, minHeight: 0 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, maxWidth: 760, width: "100%", alignSelf: "center" } as object,
  err: { fontSize: 13, color: "var(--danger)" as string, padding: 20 },
});
