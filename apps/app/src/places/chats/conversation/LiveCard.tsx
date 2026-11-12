// The live card in a message (rc.9): the agent's screen, small, while its computer works for this chat, and the last picture it showed once the work is over. It is a `screenshot` block marked live
// (modules/computers/handlers/tools/common.ts posts it with the first step of a burst of work). Pressing it opens the computer beside the chat. The state is read when the card appears and every few
// seconds while it is live, so the card freezes by itself when the computer sleeps or the work ends.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "../../../../../../ui/src/Card/index.tsx";
import { LiveScreen } from "../computer/LiveScreen.tsx";
import { BrowserLive } from "../rightpane/BrowserLive.tsx";

export interface LiveCardConfig {
  call(cap: string, input: unknown): Promise<unknown>;
  now(): number;
  spaceUrl?: string | undefined;
  /** Open the agent's computer beside the chat. */
  openComputer(agentId: string): void;
  /** The agent this chat follows: whose computer the card opens. */
  agentId: string;
}

const POLL_MS = 5000;
const LIVE = new Set(["working", "takeover"]);

/** The state of an agent's profile in the Space browser, in the words the card uses for a computer: working while the agent uses it, takeover while a person has it, asleep otherwise. */
export function browserState(row: { running?: boolean; busy?: boolean; takeoverBy?: string } | undefined): string {
  if (!row) return "asleep";
  if (row.takeoverBy) return "takeover";
  return row.running && row.busy ? "working" : "asleep";
}

/**
 * One card for both places an agent works: its computer (`computerId`, a `screenshot` block) and its profile in the Space browser (`agentId`, a `browser_screenshot` block, f-wire 12 Nov). The state
 * is read from computers.get or computers.browser.profiles, the live view is the computer's screen or the browser's, and the picture once it is over is the block's own frame in Files.
 */
export function LiveCard({ computerId, agentId, fileId, caption, id, cfg }: { computerId?: string | undefined; agentId?: string | undefined; fileId: string; caption: string; id: string; cfg: LiveCardConfig }): ReactElement {
  const [state, setState] = useState<string | null>(null);
  const [still, setStill] = useState<string | null>(null);
  // the config is rebuilt with the page; the card reads it as it is and looks again only for another computer
  const now = useRef(cfg);
  now.current = cfg;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = (): void => {
      const read = computerId
        ? now.current.call("computers.get", { computerId }).then((r) => (r as { computer?: { state?: string } }).computer?.state ?? "asleep")
        : now.current.call("computers.browser.profiles", {}).then((r) => browserState(((r as { profiles?: Array<{ agentId: string; running?: boolean; busy?: boolean; takeoverBy?: string }> }).profiles ?? []).find((x) => x.agentId === agentId)));
      void read.then((s) => {
        if (!live) return;
        setState(s);
        if (LIVE.has(s)) { timer = setTimeout(look, POLL_MS); (timer as unknown as { unref?: () => void }).unref?.(); }
      }, () => { if (live) setState("asleep"); });
    };
    look();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [computerId, agentId]);
  const frozen = state !== null && !LIVE.has(state);
  useEffect(() => {
    if (!frozen || still !== null) return;
    let live = true;
    void now.current.call("files.read", { fileId, as: "base64" }).then((r) => {
      const b = (r as { base64?: string; truncated?: boolean }).base64;
      if (live && typeof b === "string" && b !== "") setStill(`data:image/png;base64,${b}`);
    }, () => undefined);
    return () => { live = false; };
  }, [frozen, still, fileId]);
  const open = (): void => cfg.openComputer(agentId ?? cfg.agentId);
  return (
    <Card kind="progress" size="compact" flush testID={`live-card-${id}`} label={frozen ? caption : `Live: ${caption}`}>
      {state !== null && !frozen && !computerId && agentId ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open the browser" testID={`live-card-screen-${id}`} onPress={open} style={s.screen}>
          <BrowserLive agentId={agentId} control={false} call={cfg.call} spaceUrl={cfg.spaceUrl} testID={`live-card-stream-${id}`} />
        </Pressable>
      ) : state !== null && !frozen && computerId ? (
        <LiveScreen computerId={computerId} state={state} call={cfg.call} spaceUrl={cfg.spaceUrl} now={cfg.now} control={false} onIdlePress={open} testID={`live-card-screen-${id}`} streamTestID={`live-card-stream-${id}`} label="Open the computer" style={s.screen}>
          <View style={s.fallback} />
        </LiveScreen>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Open the computer" testID={`live-card-still-${id}`} onPress={open} style={s.screen}>
          {still ? <Image source={{ uri: still }} resizeMode="contain" style={s.fill} /> : <View style={s.fallback} />}
        </Pressable>
      )}
      <View style={s.foot}>
        <View testID={`live-card-dot-${id}`} style={[s.dot, !frozen && state !== null && s.dotLive]} />
        <Text numberOfLines={1} style={s.caption}>{caption}</Text>
        <Text style={s.when}>{state === null ? "" : frozen ? "Done" : "Live"}</Text>
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  screen: { height: 190, backgroundColor: "#1a1c22" as string },
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  fallback: { flex: 1, backgroundColor: "#1a1c22" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--ink-4)" as string },
  dotLive: { backgroundColor: "var(--ok)" as string },
  caption: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
  when: { fontSize: 12, color: "var(--ink-3)" as string },
});
