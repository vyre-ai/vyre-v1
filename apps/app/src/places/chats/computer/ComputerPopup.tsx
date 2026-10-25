// The computer popup (spec 2.7): the agent's computer at about 90 percent of the window with the rest dimmed. The only controls are icons on the side: Take over (it flips to Give
// back), Record (while you are in control), Chat and Close; Esc also closes. Taking over sends your clicks and keys to the agent's desktop. Recording captures every click and
// key, each page, the network traffic and the video; when you stop, one sheet asks what the agent should do with it: make a skill, learn a routine, work out the app's backend
// calls, learn this workflow, any of them. Send, Save Only or Discard. Passwords and sealed fields are masked.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { createForwarder, discardRecording, giveBack, keepRecording, openStream, sendRecording, startRecording, stopRecording, takeOver, wake } from "./actions.ts";
import type { PopupDeps } from "./actions.ts";
import { PopupDataProvider, useCapture, useOnline, useOptionalPopupData, usePopupData, useScreenQuery } from "./data.tsx";
import type { ComputerPopupData } from "./data.tsx";
import { DEFAULT_INTENTS, MASKED_NOTE, NO_CAPTURE, captureLine, captureParts, mmss, options, orderedIntents, popupView, railItems, toggleIntent } from "./model.ts";
import type { Capture, Intent, Recording } from "./model.ts";
import { Desk, Icon, RailButton, SheetButton } from "./parts.tsx";
import type { IconName } from "./parts.tsx";

type ComputerOut = CapMap["computers.get"]["out"];

export const POPUP_SCREEN = "chats.computer-popup";
export const CHAT_W = 380;
export const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as "absolute";

export interface PopupInitial {
  chat?: boolean;
  /** A recording already running (the shell reopened the popup, or a screenshot of one). */
  recording?: { recordingId: string; startedAt: number };
  /** The sheet already open for a stopped recording. */
  sheet?: { recording: Recording; capture: Capture; secs: number };
}

export function ComputerPopup({ data, initial }: { data?: ComputerPopupData; initial?: PopupInitial }): ReactElement | null {
  const ctx = useOptionalPopupData();
  const value = data ?? ctx;
  if (!value) return <ComputerPopupLoading />;
  return <PopupDataProvider value={value}><PopupView {...(initial ? { initial } : {})} /></PopupDataProvider>;
}

/** The veil and an empty window of the right size before data, so nothing moves when the data arrives. */
export function ComputerPopupLoading(): ReactElement {
  return <View testID="popup-loading" accessibilityLabel="Loading" style={st.veil}><View style={st.stage}><View style={st.win} /></View></View>;
}

interface DomEvent {
  clientX?: number;
  clientY?: number;
  deltaX?: number;
  deltaY?: number;
  currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } };
  preventDefault?: () => void;
}

interface Sheet { recording: Recording; capture: Capture; secs: number }

function PopupView({ initial }: { initial?: PopupInitial }): ReactElement {
  const data = usePopupData();
  const online = useOnline();
  const capture = useCapture();
  const name = data.agent.name;
  const [chat, setChat] = useState(initial?.chat === true);
  const [rec, setRec] = useState<{ recordingId: string; startedAt: number } | null>(initial?.recording ?? null);
  const [sheet, setSheet] = useState<Sheet | null>(initial?.sheet ?? null);
  const [picked, setPicked] = useState<Intent[]>([...DEFAULT_INTENTS]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [line, setLine] = useState("");
  const [, setTick] = useState(0);
  const [stream, setStream] = useState<{ transport: "webrtc" | "mjpeg"; url: string; ticket: string } | null>(null);
  const box = useRef({ width: 0, height: 0 });
  const screenNode = useRef<unknown>(null);
  const q = useScreenQuery<ComputerOut>(POPUP_SCREEN, "computer", { computerId: data.computerId });
  const deps: PopupDeps = useMemo(() => ({ call: data.call, note: (text: string) => setLine(text) }), [data.call]);
  const forwarder = useMemo(() => createForwarder(deps, data.computerId, data.display), [deps, data.computerId, data.display]);
  const state = q.status === "ready" ? q.data.computer.state : null;
  const reachable = state === "working" || state === "takeover";

  const recSecs = rec ? Math.max(0, Math.floor((data.clock().now - rec.startedAt) / 1000)) : null;

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);

  useEffect(() => {
    if (!reachable) { setStream(null); return; }
    let live = true;
    void openStream(deps, data.computerId).then((s) => { if (live && s) setStream({ transport: s.transport, url: s.url, ticket: s.ticket }); });
    return () => { live = false; };
  }, [reachable, deps, data.computerId]);

  const close = useCallback((): void => {
    if (rec) { setLine("Recording is still on. Stop it first, or it will be lost."); return; }
    if (sheet) keepRecording(deps, sheet.recording.folderPath);
    data.nav.close();
  }, [rec, sheet, deps, data.nav]);

  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      const tag = ((e.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase();
      if (state !== "takeover" || sheet || tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      void forwarder.key({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey });
      setTimeout(() => void forwarder.flush(), 120);
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [close, forwarder, state, sheet]);

  if (q.status === "loading") return <ComputerPopupLoading />;
  const c = q.data.computer;
  const view = popupView(c, name, recSecs);
  const rail = railItems(c, recSecs, chat);

  const press = (key: string): void => {
    if (key === "take") void (c.state === "takeover" ? giveBack(deps, c.computerId, name) : takeOver(deps, c.computerId, name));
    if (key === "chat") setChat((x) => !x);
    if (key === "close") close();
    if (key === "record") {
      if (rec) {
        const startedAt = rec.startedAt;
        const secs = Math.max(1, Math.floor((data.clock().now - startedAt) / 1000));
        const cap = data.capture.get();
        void stopRecording(deps, c.computerId).then((r) => { if (r) { setRec(null); setSheet({ recording: r, capture: cap, secs }); setPicked([...DEFAULT_INTENTS]); setConfirmDiscard(false); } });
      } else {
        void startRecording(deps, c.computerId).then((id) => { if (id) setRec({ recordingId: id, startedAt: data.clock().now }); });
      }
    }
  };
  const icons: Record<string, IconName> = { take: "hand", record: rec ? "recstop" : "recdot", chat: "bubble", close: "x" };
  const railNodes: ReactElement[] = [];
  for (const r of rail) railNodes.push(<RailButton key={r.key} label={r.label} tip={r.tip} icon={icons[r.key] ?? "x"} on={r.on} disabled={r.disabled} danger={r.key === "record"} {...(r.timer ? { timer: r.timer } : {})} onPress={() => press(r.key)} testID={`rail-${r.key}`} />);

  const screenPress = (e: { nativeEvent?: { locationX?: number; locationY?: number } }): void => {
    if (c.state !== "takeover") { if (c.state === "asleep") void wake(deps, c.computerId, name); return; }
    void forwarder.press(e.nativeEvent?.locationX ?? 0, e.nativeEvent?.locationY ?? 0, box.current, data.clock().now);
  };

  // Right click and the wheel exist only on the web, where they arrive as DOM events on the screen. They go to the agent's desktop only while you are in control; the browser's own
  // menu and page scroll never open over the screen.
  const domPoint = (e: DomEvent): { x: number; y: number } => {
    const r = e.currentTarget?.getBoundingClientRect?.();
    return { x: (e.clientX ?? 0) - (r?.left ?? 0), y: (e.clientY ?? 0) - (r?.top ?? 0) };
  };
  // Right click (and long press) arrive through the shared menuTrigger, which also keeps the browser's own menu from opening over the screen; the point is made relative to the
  // screen from its box. Only while you are in control does either go to the agent's desktop.
  const trigger = menuTrigger((x, y) => {
      if (c.state !== "takeover") return;
      const r = (screenNode.current as { getBoundingClientRect?: () => { left: number; top: number } } | null)?.getBoundingClientRect?.();
      void forwarder.press(x - (r?.left ?? 0), y - (r?.top ?? 0), box.current, data.clock().now, "right");
  });
  delete trigger.onKeyDown; // the menu key is a key for the desktop, not a right click
  const screenWeb: Record<string, unknown> = {
    ...trigger,
    ...(Platform.OS !== "web" ? {} : {
      onWheel: (e: DomEvent) => {
        if (c.state !== "takeover") return;
        e.preventDefault?.();
        const p = domPoint(e);
        void forwarder.scroll(p.x, p.y, box.current, e.deltaX ?? 0, e.deltaY ?? 0);
      },
    }),
  };

  const parts = captureParts(rec ? capture : NO_CAPTURE);
  const partNodes: ReactElement[] = [];
  for (const p of parts) partNodes.push(<Text key={p} style={st.capText}>{p}</Text>);

  return (
    <View testID="computer-popup" role="dialog" aria-label={`${name}'s computer`} aria-modal style={st.veil}>
      <View style={st.stage}>
        {chat ? (
          <View testID="popup-chat" accessibilityLabel="Chat" style={st.chat}>
            {data.renderChat ? data.renderChat(data.agent) : <Text style={st.chatHint}>{`Talk to ${name} while you watch.`}</Text>}
          </View>
        ) : null}
        <View testID="popup-window" style={[st.win, view.screen === "mine" && st.winMine, rec !== null && st.winRec]}>
          <View style={st.pillWrap} pointerEvents="none"><View testID="popup-pill" style={st.pill}><View style={[st.pillDot, view.screen === "mine" && st.pillMine, rec !== null && st.pillRec]} /><Text style={st.pillText}>{view.pill}</Text></View></View>
          <Pressable
            accessibilityRole="button" accessibilityLabel={c.state === "asleep" ? `Wake ${name}'s computer` : `${name}'s computer`} testID="popup-screen" onPress={screenPress} disabled={!online && c.state === "takeover"}
            onLayout={(e) => { box.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}
            ref={(n) => { screenNode.current = n; }}
            style={st.screen}
            {...screenWeb}
          >
            <Desk kind={view.screen} caption="Elena Rivera, referred by Maya" />
            {stream && stream.transport === "mjpeg" ? <Image testID="popup-stream" accessibilityLabel="Live view" source={{ uri: `${stream.url}?ticket=${stream.ticket}` }} resizeMode="contain" style={st.stream} /> : null}
            {c.state === "asleep" ? <View style={st.wakeWrap}><View testID="popup-wake" style={st.wake}><Icon name="moon" size={14} /><Text style={st.wakeText}>Wake</Text></View></View> : null}
          </Pressable>
          {rec ? <View testID="popup-capture" style={st.capture}>{partNodes}</View> : null}
          {line ? <View testID="popup-line" style={st.line}><Text numberOfLines={2} style={st.lineText}>{line}</Text></View> : null}
          {sheet ? (
            <RecordSheet
              sheet={sheet} name={name} picked={picked} confirm={confirmDiscard}
              onToggle={(k) => setPicked((p) => toggleIntent(p, k))}
              onSend={() => void sendRecording(deps, sheet.recording.recordingId, orderedIntents(picked, name), name).then((id) => { if (id) setSheet(null); })}
              onSave={() => { keepRecording(deps, sheet.recording.folderPath); setSheet(null); }}
              onAskDiscard={() => setConfirmDiscard(true)} onCancelDiscard={() => setConfirmDiscard(false)}
              onDiscard={() => void discardRecording(deps, sheet.recording.recordingId).then((ok) => { if (ok) { setSheet(null); setConfirmDiscard(false); } })}
            />
          ) : null}
        </View>
      </View>
      <View testID="popup-rail" style={st.rail}>{railNodes}</View>
    </View>
  );
}

interface SheetProps {
  sheet: Sheet;
  name: string;
  picked: readonly Intent[];
  confirm: boolean;
  onToggle: (k: Intent) => void;
  onSend: () => void;
  onSave: () => void;
  onAskDiscard: () => void;
  onCancelDiscard: () => void;
  onDiscard: () => void;
}

/** One sheet asks what the agent should do with the recording: any of four, then Send, Save Only or Discard. */
function RecordSheet({ sheet, name, picked, confirm, onToggle, onSend, onSave, onAskDiscard, onCancelDiscard, onDiscard }: SheetProps): ReactElement {
  const opts: ReactElement[] = [];
  for (const o of options(name)) {
    const on = picked.includes(o.key);
    opts.push(
      <Pressable key={o.key} role="checkbox" aria-checked={on} aria-label={o.title} onPress={() => onToggle(o.key)} testID={`opt-${o.key}`} style={[st.opt, on && st.optOn]}>
        <View style={[st.check, on && st.checkOn]}>{on ? <Icon name="check" size={11} color="var(--accent-ink)" width={1.8} /> : null}</View>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={st.optTitle}>{o.title}</Text><Text style={st.optBlurb}>{o.blurb}</Text></View>
      </Pressable>,
    );
  }
  return (
    <View style={st.sheetWrap}>
      <View testID="record-sheet" role="dialog" aria-label="Send the recording" style={st.sheet}>
        <View style={st.sheetHead}>
          <View style={st.thumb}><Icon name="play" size={16} color="#fff" fill="#fff" /><Text testID="sheet-dur" style={st.dur}>{mmss(sheet.secs)}</Text></View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text accessibilityRole="header" style={st.sheetTitle}>{`Recording · ${mmss(sheet.secs)}`}</Text>
            <Text testID="sheet-stats" style={st.stats}>{captureLine(sheet.capture)}</Text>
            <View style={st.priv}><Icon name="shield" size={13} color="var(--ok)" /><Text style={st.privText}>{MASKED_NOTE}</Text></View>
          </View>
        </View>
        <Text style={st.q}>{`What should ${name} do with it?`}</Text>
        <View testID="sheet-options" style={st.opts}>{opts}</View>
        {confirm ? (
          <View testID="sheet-confirm" style={st.sheetFoot}>
            <Text style={st.confirmText}>Delete this recording?</Text>
            <View style={{ flex: 1 }} />
            <SheetButton label="Cancel" onPress={onCancelDiscard} testID="sheet-cancel" />
            <SheetButton label="Delete" primary onPress={onDiscard} testID="sheet-delete" />
          </View>
        ) : (
          <View style={st.sheetFoot}>
            <SheetButton label="Discard" onPress={onAskDiscard} testID="sheet-discard" />
            <View style={{ flex: 1 }} />
            <SheetButton label="Save Only" onPress={onSave} testID="sheet-save" />
            <SheetButton label={`Send to ${name}`} primary disabled={picked.length === 0} onPress={onSend} testID="sheet-send" />
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  veil: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 75, backgroundColor: "rgba(4,4,6,0.9)" as string },
  stage: { position: FIXED, left: 14, top: 14, right: 72, bottom: 14, flexDirection: "row", gap: 12 },
  chat: { width: CHAT_W, maxWidth: "45%", borderRadius: 14, overflow: "hidden", backgroundColor: "var(--win)" as string, padding: 14, justifyContent: "center" },
  chatHint: { textAlign: "center", fontSize: 13, color: "var(--ink-3)" as string },
  win: { flex: 1, minWidth: 0, borderRadius: 14, overflow: "hidden", backgroundColor: "#0f1012" as string, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" as string },
  winMine: { borderWidth: 2, borderColor: "var(--accent)" as string },
  winRec: { borderWidth: 2, borderColor: "#d0453b" as string },
  pillWrap: { position: "absolute", left: 0, right: 0, top: 14, alignItems: "center", zIndex: 3 },
  pill: { height: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)" as string },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#4cc38a" as string },
  pillMine: { backgroundColor: "var(--accent)" as string },
  pillRec: { backgroundColor: "#ff5a4d" as string },
  pillText: { fontSize: 12, fontWeight: "500", color: "#fff" },
  screen: { flex: 1 },
  stream: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  wakeWrap: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  wake: { height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.14)" as string },
  wakeText: { fontSize: 13, fontWeight: "500", color: "#fff" },
  capture: { position: "absolute", left: 0, right: 0, bottom: 14, flexDirection: "row", justifyContent: "center", gap: 14 },
  capText: { fontSize: 12, color: "#fff", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)" as string, overflow: "hidden" },
  line: { position: "absolute", left: 14, bottom: 14, maxWidth: "60%", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.7)" as string },
  lineText: { fontSize: 12.5, color: "#fff" },
  rail: { position: FIXED, right: 14, top: "50%", marginTop: -90, gap: 10, alignItems: "center", zIndex: 76 },
  sheetWrap: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" as string, zIndex: 5 },
  sheet: { width: 420, maxWidth: "92%", borderRadius: 14, backgroundColor: "var(--raised)" as string, padding: 14, gap: 12 },
  sheetHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  thumb: { width: 84, height: 56, borderRadius: 8, backgroundColor: "#1a1c22" as string, alignItems: "center", justifyContent: "center" },
  dur: { position: "absolute", right: 5, bottom: 4, fontSize: 10.5, color: "#fff", fontVariant: ["tabular-nums"] },
  sheetTitle: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  stats: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  priv: { flexDirection: "row", alignItems: "center", gap: 6 },
  privText: { fontSize: 12, color: "var(--ink-3)" as string },
  q: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  opts: { gap: 4 },
  opt: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  optOn: { backgroundColor: "var(--sel)" as string },
  check: { width: 16, height: 16, marginTop: 2, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  optTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  optBlurb: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  sheetFoot: { flexDirection: "row", alignItems: "center", gap: 8 },
  confirmText: { fontSize: 13, color: "var(--ink)" as string },
});
