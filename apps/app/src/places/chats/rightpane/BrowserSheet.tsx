// The browser, full screen (AGENT-COMPUTER-2026-11-13.md part C): pressing the picture in the Computer tab opens it. Live in one fixed 8:5 frame; Take over and Give back are here and not in the pane.
// It wakes a sleeping browser on open and shows the start with its stage words. Esc closes it while you only watch; while you hold the browser Esc goes to the page and Close closes. Closing while you hold
// it hands it back, so a closed window never leaves the agent waiting.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { useEscapeLayer } from "../../../../../../ui/src/Overlay/escape.ts";
import { Icon, TextButton } from "./parts.tsx";
import { browserHead, startStage } from "./work-model.ts";
import type { BrowserData, BrowserView } from "./work-model.ts";
import { Dot } from "./WorkParts.tsx";

const RATIO = 1.6;

export function BrowserSheet({
  agentId,
  name,
  view,
  data,
  onClose,
  onNote,
}: {
  agentId: string;
  name: string;
  view: BrowserView;
  data: BrowserData;
  onClose(): void;
  onNote(text: string): void;
}): ReactElement {
  const win = useWindowDimensions();
  const mine = view.state === "takeover" && view.mine === true;
  const [busy, setBusy] = useState(false);
  // a sleeping browser wakes when the sheet opens: the call that hands out the live address is the one that starts it
  const woke = useRef(false);
  useEffect(() => {
    if (view.state !== "closed" || woke.current) return;
    woke.current = true;
    data
      .open(agentId)
      .catch((e: unknown) => onNote(e instanceof Error && e.message ? e.message : "The browser did not start."));
  }, [view.state, agentId, data, onNote]);
  const starting = view.state === "closed" || view.state === "starting";
  const t0 = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (!starting) return undefined;
    const i = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(i);
  }, [starting]);
  const close = (): void => {
    if (mine) void data.giveBack(agentId).catch(() => undefined);
    onClose();
  };
  // Esc closes while you only watch; while you hold the browser it belongs to the page
  useEscapeLayer(!mine, close);
  const head = browserHead(view);
  const run = (f: () => Promise<void>): void => {
    setBusy(true);
    void f()
      .catch((e: unknown) => onNote(e instanceof Error && e.message ? e.message : "That did not work. Try again."))
      .finally(() => setBusy(false));
  };
  // the frame keeps its 8:5 shape and fits the window under the header and the bar
  const maxH = Math.max(160, win.height - 150);
  const width = Math.min(win.width - 32, maxH * RATIO);
  const bar = barOf(view, name, mine, Date.now() - t0.current);
  const live = view.state === "open" || view.state === "takeover";
  return (
    <Overlay>
      <View testID="browser-popup" role="dialog" aria-modal accessibilityLabel={`${name}'s browser`} style={st.veil}>
        <View style={st.head}>
          <Icon name="globe" size={16} color="var(--ink-2)" />
          <Text style={st.title} numberOfLines={1}>{`${name}'s browser`}</Text>
          <Dot tone={head.dot} />
          <Text style={st.word}>{head.word}</Text>
          <View style={{ flex: 1 }} />
          <TextButton label="Close" onPress={close} testID="browser-popup-close" />
        </View>
        <View
          testID="browser-popup-bar"
          style={[st.bar, bar.tone === "wait" && st.barWait, bar.tone === "bad" && st.barBad, mine && st.barMine]}
        >
          <Text style={st.barBold}>{bar.title}</Text>
          {bar.note ? (
            <Text style={st.barNote} numberOfLines={1}>
              {bar.note}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {bar.action === "take" ? (
            <TextButton
              label="Take over"
              primary
              disabled={busy}
              onPress={() => run(() => data.takeOver(agentId))}
              testID="browser-take"
            />
          ) : null}
          {bar.action === "give" ? (
            <TextButton
              label="Give back"
              primary
              disabled={busy}
              onPress={() => run(() => data.giveBack(agentId))}
              testID="browser-give"
            />
          ) : null}
          {bar.action === "restart" ? (
            <TextButton
              label="Restart"
              primary
              disabled={busy}
              onPress={() => run(() => data.open(agentId))}
              testID="browser-restart"
            />
          ) : null}
        </View>
        <View style={st.stage}>
          <View testID="browser-live" style={[st.frame, { width, height: width / RATIO }, mine && st.frameMine]}>
            {live ? (
              data.renderLive?.(agentId, { state: view.state, control: mine })
            ) : (
              <View style={st.skeleton}>
                <View style={[st.sk, { width: "46%" }]} />
                <View style={[st.sk, { width: "70%" }]} />
                <View style={[st.sk, { width: "58%" }]} />
              </View>
            )}
          </View>
        </View>
      </View>
    </Overlay>
  );
}

interface Bar {
  title: string;
  note?: string;
  tone: "quiet" | "wait" | "bad";
  action: "take" | "give" | "restart" | null;
}
export function barOf(v: BrowserView, name: string, mine: boolean, elapsedMs: number): Bar {
  if (v.state === "closed" || v.state === "starting")
    return { title: "Starting the browser", note: startStage(elapsedMs), tone: "wait", action: null };
  if (v.state === "waiting")
    return { title: "Waiting for room", ...(v.line ? { note: v.line } : {}), tone: "wait", action: null };
  if (v.state === "error") return { title: "The browser stopped", tone: "bad", action: "restart" };
  if (v.state === "takeover")
    return mine
      ? { title: "You have the browser", note: `${name}'s actions wait.`, tone: "quiet", action: "give" }
      : { title: `${v.takenBy ?? "Someone"} has the browser`, tone: "wait", action: null };
  if (!v.canTakeOver)
    return {
      title: "You can watch.",
      note: v.cannotTakeOver ?? "Only people who can use it can take over.",
      tone: "quiet",
      action: null,
    };
  return { title: v.caption ? `${name} is browsing` : "Watching", tone: "quiet", action: "take" };
}

const st = StyleSheet.create({
  veil: {
    position: "fixed" as never,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99998,
    backgroundColor: "var(--win)" as string,
  },
  head: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line-2)" as string,
  },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  word: { fontSize: 12.5, color: "var(--ink-3)" as string },
  bar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: "var(--sunk)" as string,
  },
  barWait: { backgroundColor: "var(--warn-soft, var(--sunk))" as string },
  barBad: { backgroundColor: "var(--danger-soft, var(--sunk))" as string },
  barMine: { backgroundColor: "var(--accent-soft, var(--sunk))" as string },
  barBold: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  barNote: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  frame: {
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#f5f6f8" as string,
    borderWidth: 1,
    borderColor: "var(--line-2)" as string,
  },
  frameMine: { borderWidth: 2, borderColor: "var(--accent)" as string },
  skeleton: { flex: 1, padding: 24, gap: 12 },
  sk: { height: 10, borderRadius: 5, backgroundColor: "#e3e5ea" as string },
});
