// ui/LiveSurface: one component for a live picture, stream or terminal in a fixed box (the browser preview in the pane, the browser and a terminal in a sheet, the older desktop).
// It never polls: frames arrive from `source`, and it lets go of the source when it is hidden (a collapsed tab, a hidden pane, a blurred or backgrounded window), which is what stops the screencast.
// A picture is loaded off screen and swapped in only when it is ready, so the last good frame stays until the next has loaded and a slow old frame never replaces a newer one; a frame of another
// size is fitted inside the box and never resizes it, so nothing jumps. The box has the aspect ratio it was given for its whole life.
//   starting  the last still, greyed, with the stage and the seconds so far (a clock that ticks here, no request)
//   live      the frames
//   asleep    the still with "Asleep. Last seen <time>" and a play mark
//   failed    the plain reason with Retry
// `mode` draws "You are watching" or "You are in control" in a corner; in control the clicks and keys go to what is inside. With `onPress` the whole surface is one button.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { LoadFailed } from "../States/Loads.tsx";
import type { LoadFailure } from "../States/Loads.tsx";
import { When } from "../Time/index.tsx";

export interface Frame {
  uri: string;
  width: number;
  height: number;
}
export interface FrameSource {
  subscribe(on: (frame: Frame) => void): () => void;
}
export interface LiveSurfaceProps {
  kind: "picture" | "stream" | "terminal";
  /** Width over height, fixed for the surface's life (from the stream's size). */
  aspect: number;
  state: "starting" | "live" | "asleep" | "failed";
  stage?: string;
  /** When it began starting, for the seconds shown. */
  startedAt?: number;
  source?: FrameSource;
  still?: { uri: string; at: number };
  mode?: "watching" | "control";
  failure?: LoadFailure;
  onRetry?(): void;
  onPress?(): void;
  /** Overrides the page's own visibility (a collapsed tab or hidden pane that the page cannot see). */
  visible?: boolean;
  /** A live surface that has had no frame for this long stops looking live: the picture greys and says so. Default 8 s. */
  staleAfterMs?: number;
  testID?: string;
  /** A terminal draws its own text here. */
  children?: ReactNode;
}

/** Loads frames off screen and shows each only when ready; the shown one stays until a newer one has loaded, and an older one that answers late is dropped. */
export function createFrameSwapper(
  preload: (f: Frame) => Promise<void>,
  show: (f: Frame) => void,
): { push(f: Frame): void; current(): Frame | null; reset(): void } {
  let asked = 0;
  let shownAt = 0;
  let epoch = 0;
  let current: Frame | null = null;
  return {
    push(f) {
      const mine = ++asked;
      const era = epoch;
      void preload(f).then(
        () => {
          if (era !== epoch || mine < shownAt) return;
          shownAt = mine;
          current = f;
          show(f);
        },
        () => undefined,
      );
    },
    current: () => current,
    // a new source, hidden, or no longer live: nothing from before may show, and nothing still loading may land
    reset() {
      epoch++;
      current = null;
    },
  };
}

interface Listenable {
  addEventListener(t: string, f: () => void): void;
  removeEventListener(t: string, f: () => void): void;
}
/** Tells whether the page is shown and focused: hidden tabs and blurred windows are not watching. Answers how to stop. */
export function watchVisibility(
  doc: Listenable & { visibilityState?: string },
  win: Listenable,
  on: (visible: boolean) => void,
): () => void {
  let focused = true;
  const tell = (): void => on(doc.visibilityState !== "hidden" && focused);
  const blur = (): void => {
    focused = false;
    tell();
  };
  const focus = (): void => {
    focused = true;
    tell();
  };
  doc.addEventListener("visibilitychange", tell);
  win.addEventListener("blur", blur);
  win.addEventListener("focus", focus);
  return () => {
    doc.removeEventListener("visibilitychange", tell);
    win.removeEventListener("blur", blur);
    win.removeEventListener("focus", focus);
  };
}

const web = Platform.OS === "web";

function usePageVisible(override: boolean | undefined): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const g = globalThis as {
      document?: Listenable & { visibilityState?: string };
      addEventListener?: Listenable["addEventListener"];
      removeEventListener?: Listenable["removeEventListener"];
    };
    if (!web || !g.document || !g.addEventListener || !g.removeEventListener) return undefined;
    return watchVisibility(g.document, g as Listenable, setSeen);
  }, []);
  return override ?? seen;
}

const preloadImage = (f: Frame): Promise<void> =>
  new Promise((res, rej) => {
    const Img = (
      globalThis as unknown as { Image?: new () => { onload: () => void; onerror: () => void; src: string } }
    ).Image;
    if (!Img) return res();
    const i = new Img();
    i.onload = () => res();
    i.onerror = () => rej(new Error("frame did not load"));
    i.src = f.uri;
  });

function Seconds({ since, paused }: { since: number; paused: boolean }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paused]);
  return <Text style={st.stage}>{`${Math.max(0, Math.round((now - since) / 1000))} s`}</Text>;
}

export function LiveSurface({
  kind,
  aspect,
  state,
  stage,
  startedAt,
  source,
  still,
  mode,
  failure,
  onRetry,
  onPress,
  visible,
  staleAfterMs = 8000,
  testID,
  children,
}: LiveSurfaceProps): ReactElement {
  const shown = usePageVisible(visible);
  const [frame, setFrame] = useState<Frame | null>(null);
  const swapper = useRef<ReturnType<typeof createFrameSwapper> | null>(null);
  if (swapper.current === null) swapper.current = createFrameSwapper(preloadImage, setFrame);
  const [quiet, setQuiet] = useState(false);
  // the source is held only while the surface is live and shown. When that stops (a new source, hidden, asleep, failed) every frame from before is dropped, loading ones included: a picture of an earlier
  // moment or another computer must never show as live. A live surface with no frame for `staleAfterMs` greys itself and says so.
  useEffect(() => {
    if (!source || state !== "live" || !shown) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setQuiet(true), staleAfterMs);
      (timer as { unref?: () => void }).unref?.();
    };
    arm();
    const off = source.subscribe((f) => {
      setQuiet(false);
      arm();
      swapper.current?.push(f);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
      swapper.current?.reset();
      setFrame(null);
      setQuiet(false);
    };
  }, [source, state, shown, staleAfterMs]);
  const live = state === "live" && frame !== null && !quiet;
  const picture = frame && state === "live" ? frame.uri : still?.uri;
  const body = (
    <View
      testID={testID}
      style={[st.box, { aspectRatio: aspect }]}
      accessibilityLabel={kind === "terminal" ? "Terminal" : kind === "stream" ? "Live view" : "Picture"}
    >
      {picture ? <Image source={{ uri: picture }} resizeMode="contain" style={[st.fill, !live && st.grey]} /> : null}
      {kind === "terminal" ? <View style={st.fill}>{children}</View> : null}
      {state === "starting" ? (
        <View style={st.over}>
          <Text style={st.stage}>{stage ?? "Starting"}</Text>
          {startedAt !== undefined ? <Seconds since={startedAt} paused={!shown} /> : null}
        </View>
      ) : null}
      {state === "asleep" ? (
        <View style={st.over}>
          <Text style={st.play}>{"▶"}</Text>
          <Text style={st.stage}>
            Asleep. Last seen {still ? <When at={still.at} now={Date.now()} as="date" /> : null}
          </Text>
        </View>
      ) : null}
      {state === "failed" ? (
        <View style={st.overSolid}>
          <LoadFailed
            what={kind === "terminal" ? "the terminal" : "the view"}
            failure={failure ?? { message: "It stopped." }}
            {...(onRetry ? { onRetry } : {})}
          />
        </View>
      ) : null}
      {picture && !live && state !== "failed" ? (
        <View style={st.notLive} pointerEvents="none">
          <Text style={st.markText}>Not live</Text>
        </View>
      ) : null}
      {mode ? (
        <View style={st.mark} pointerEvents="none">
          <Text style={st.markText}>{mode === "control" ? "You are in control" : "You are watching"}</Text>
        </View>
      ) : null}
    </View>
  );
  // a failed surface keeps its own Retry: a button around it would hold a button
  if (!onPress || state === "failed") return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open"
      testID={`${testID ?? "live"}-open`}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

const st = StyleSheet.create({
  box: { width: "100%", backgroundColor: "#111", overflow: "hidden", borderRadius: 8 },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  grey: { opacity: 0.4 },
  over: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  overSolid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "var(--win)" as string,
    borderRadius: 8,
  },
  stage: { fontSize: 13, color: "#fff" },
  play: { fontSize: 22, color: "#fff" },
  notLive: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  mark: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  markText: { fontSize: 11.5, color: "#fff" },
});
